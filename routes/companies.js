const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/init');
const { requireAuth, requireRole } = require('../middleware/auth');
const { broadcast } = require('../realtime/ws');
const { importEmpresas, importAllSheets, countCompanies } = require('../lib/import-empresas');
const { importResponsaveis, importTasks } = require('../lib/import-users-tasks');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const STATUS_LABELS = {
  '-1': 'Atrasado',
  0: 'Entregue',
  1: 'Em Andamento',
};

function withComputed(row) {
  let deadline_state = null; // 'overdue' | 'today' | 'soon' | null
  if (row.data_limite && /^\d{4}-\d{2}-\d{2}$/.test(row.data_limite)) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadline = new Date(row.data_limite + 'T00:00:00');
    const diffDays = Math.round((deadline - today) / (1000 * 60 * 60 * 24));

    if (row.status_code !== 0) {
      // Só sinaliza prazo se a obrigação ainda não foi marcada como entregue
      if (diffDays < 0) deadline_state = 'overdue';
      else if (diffDays === 0) deadline_state = 'today';
      else if (diffDays <= 3) deadline_state = 'soon';
    }
  }
  return { ...row, deadline_state };
}

// GET /api/companies - lista com busca e filtros
// ?q=texto (busca em razão social, CNPJ, código)
// ?status=-1|0|1  ?estado=  ?tributacao=  ?usuario=  ?deadline=overdue|today|soon
router.get('/', requireAuth, (req, res) => {
  const { q, status, estado, tributacao, usuario, com_tarefas } = req.query;
  let query = 'SELECT * FROM companies WHERE 1=1';
  const params = [];

  // Restringe às empresas que têm ao menos uma tarefa vinculada de verdade
  // (usado, por exemplo, no filtro "Empresa" do quadro de tarefas).
  if (com_tarefas === '1') {
    query += ' AND id IN (SELECT DISTINCT company_id FROM tasks WHERE company_id IS NOT NULL)';
  }

  if (q) {
    query += ' AND (razao_social LIKE ? OR cnpj LIKE ? OR CAST(codigo AS TEXT) LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (status !== undefined && status !== '') {
    query += ' AND status_code IS ?';
    params.push(status === 'null' ? null : Number(status));
  }
  if (estado) {
    query += ' AND estado = ?';
    params.push(estado);
  }
  if (tributacao) {
    query += ' AND tributacao = ?';
    params.push(tributacao);
  }
  if (usuario) {
    query += ' AND usuario = ?';
    params.push(usuario);
  }
  query += ' ORDER BY razao_social ASC';

  let companies = db.prepare(query).all(...params).map(withComputed);

  if (req.query.deadline) {
    companies = companies.filter((c) => c.deadline_state === req.query.deadline);
  }

  res.json(companies);
});

// GET /api/companies/summary - contagens para o painel/dashboard
router.get('/summary', requireAuth, (req, res) => {
  const all = db.prepare('SELECT * FROM companies').all().map(withComputed);

  const byStatus = { '-1': 0, 0: 0, 1: 0, null: 0 };
  let overdue = 0;
  let dueSoon = 0;
  let dueToday = 0;

  all.forEach((c) => {
    const key = c.status_code === null ? 'null' : String(c.status_code);
    byStatus[key] = (byStatus[key] || 0) + 1;
    if (c.deadline_state === 'overdue') overdue++;
    if (c.deadline_state === 'soon') dueSoon++;
    if (c.deadline_state === 'today') dueToday++;
  });

  const estados = db.prepare('SELECT DISTINCT estado FROM companies WHERE estado IS NOT NULL ORDER BY estado').all().map((r) => r.estado);
  const tributacoes = db.prepare('SELECT DISTINCT tributacao FROM companies WHERE tributacao IS NOT NULL ORDER BY tributacao').all().map((r) => r.tributacao);
  const usuarios = db.prepare('SELECT DISTINCT usuario FROM companies WHERE usuario IS NOT NULL ORDER BY usuario').all().map((r) => r.usuario);

  res.json({
    total: all.length,
    entregue: byStatus['0'],
    atrasado: byStatus['-1'],
    em_andamento: byStatus['1'],
    sem_status: byStatus['null'],
    overdue,
    due_today: dueToday,
    due_soon: dueSoon,
    filtros: { estados, tributacoes, usuarios },
  });
});

// POST /api/companies/import-users-tasks - cria os responsáveis (usuários)
// e as tarefas a partir da aba "Empresas" da planilha, preservando os
// vínculos reais (empresa, responsável, prazo, status). Não inventa nada
// que não esteja na planilha; ver comentários em lib/import-users-tasks.js.
router.post('/import-users-tasks', requireAuth, requireRole('admin'), upload.single('file'), (req, res) => {
  const defaultXlsx = path.join(__dirname, '..', 'planilha.xlsx');
  const source = req.file ? req.file.buffer : (fs.existsSync(defaultXlsx) ? defaultXlsx : null);

  if (!source) {
    return res.status(400).json({ error: 'Nenhuma planilha enviada, e não há planilha.xlsx padrão no servidor.' });
  }

  try {
    const usersResult = importResponsaveis(source);
    const tasksResult = importTasks(source);
    broadcast('task:created', {});
    broadcast('companies:imported', {});
    res.json({
      users_created: usersResult.created,
      tasks_created: tasksResult.created,
      tasks_skipped_no_responsavel: tasksResult.skippedNoResponsavel,
      tasks_skipped_already_imported: tasksResult.skippedAlreadyImported,
      tasks_skipped_no_company: tasksResult.skippedNoCompany,
    });
  } catch (err) {
    const status = err.code === 'SHEET_NOT_FOUND' ? 422 : 500;
    res.status(status).json({ error: err.message || 'Falha ao importar responsáveis e tarefas.' });
  }
});

// POST /api/companies/import - importa uma planilha .xlsx enviada pelo navegador
// (equivalente ao "npm run import-empresas", mas sem precisar de terminal)
router.post('/import', requireAuth, requireRole('admin'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

  try {
    const result = importAllSheets(req.file.buffer);
    broadcast('companies:imported', result);
    res.json({ ...result, total: countCompanies() });
  } catch (err) {
    const status = err.code === 'SHEET_NOT_FOUND' ? 422 : 500;
    res.status(status).json({ error: err.message || 'Falha ao importar a planilha.' });
  }
});

// POST /api/companies - cadastra uma empresa nova direto pelo site (nunca
// veio da planilha). O "código" é gerado automaticamente numa faixa alta
// (900000+) para nunca colidir com os códigos que já existem na planilha.
const COMPANY_CREATE_FIELDS = [
  'cnpj', 'razao_social', 'tributacao', 'inscricao_estadual', 'estado', 'inscricao_municipal',
  'municipio', 'partes_relacionadas', 'usuario', 'eventos', 'envio_documentos', 'dia_util',
  'data_limite', 'data_inicio', 'data_final', 'status_code', 'acompanhamento',
  'procuracoes', 'conferencia',
];

router.post('/', requireAuth, (req, res) => {
  const { razao_social } = req.body;
  if (!razao_social || !String(razao_social).trim()) {
    return res.status(400).json({ error: 'Razão social é obrigatória.' });
  }

  const maxCodigo = db.prepare('SELECT MAX(codigo) AS m FROM companies').get().m || 0;
  const codigo = Math.max(900000, maxCodigo + 1);

  const extraFields = COMPANY_CREATE_FIELDS.filter((f) => req.body[f] !== undefined);
  const columns = ['codigo', ...extraFields];
  const placeholders = columns.map(() => '?');
  const values = [codigo, ...extraFields.map((f) => req.body[f])];

  db.prepare(`INSERT INTO companies (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`).run(...values);

  const created = withComputed(db.prepare('SELECT * FROM companies WHERE codigo = ?').get(codigo));
  broadcast('company:created', { id: created.id });
  res.status(201).json(created);
});

// GET /api/companies/:id
router.get('/:id', requireAuth, (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
  res.json(withComputed(company));
});

function onlyDigits(value) {
  return value ? String(value).replace(/\D/g, '') : '';
}

const OBLIGATION_TITLES = {
  municipal: 'Obrigações Municipais',
  estadual: 'Obrigações Estaduais',
  federal: 'Obrigações Federais',
  anual: 'Obrigações Anuais',
};

// GET /api/companies/:id/ficha - reúne dados gerais + obrigações fiscais +
// parcelamentos (ativos e encerrados) de uma empresa num só lugar, ligando
// pelo código (obrigações) e pelo CNPJ normalizado (parcelamentos).
router.get('/:id/ficha', requireAuth, (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const obligationRows = company.codigo !== null
    ? db.prepare('SELECT tipo, data_json, updated_at FROM company_obligations WHERE codigo = ?').all(company.codigo)
    : [];

  const obligations = ['municipal', 'estadual', 'federal', 'anual'].map((tipo) => {
    const row = obligationRows.find((r) => r.tipo === tipo);
    return {
      tipo,
      titulo: OBLIGATION_TITLES[tipo],
      itens: row ? JSON.parse(row.data_json) : [],
      updated_at: row ? row.updated_at : null,
    };
  });

  const cnpjNorm = onlyDigits(company.cnpj);
  const installmentRows = cnpjNorm
    ? db.prepare('SELECT * FROM company_installments WHERE cnpj_normalizado = ?').all(cnpjNorm)
    : [];

  const parcelamentoAtivo = installmentRows.find((r) => r.tipo === 'ativo');
  const parcelamentoEncerrado = installmentRows.find((r) => r.tipo === 'encerrado');

  const formatInstallment = (row) =>
    row
      ? {
          situacao: row.situacao,
          forma_envio: row.forma_envio,
          usuario: row.usuario,
          flags: JSON.parse(row.flags_json),
          observacoes: row.observacoes,
          updated_at: row.updated_at,
        }
      : null;

  res.json({
    company: withComputed(company),
    obligations,
    installments: {
      ativo: formatInstallment(parcelamentoAtivo),
      encerrado: formatInstallment(parcelamentoEncerrado),
    },
  });
});

// PATCH /api/companies/:id - edição inline (status, acompanhamento, datas, responsável, etc.)
const EDITABLE_FIELDS = [
  'cnpj', 'razao_social', 'tributacao', 'inscricao_estadual', 'estado', 'inscricao_municipal',
  'municipio', 'partes_relacionadas', 'usuario', 'eventos', 'envio_documentos', 'dia_util',
  'data_limite', 'data_inicio', 'data_final', 'status_code', 'acompanhamento',
  'procuracoes', 'conferencia',
];

router.patch('/:id', requireAuth, (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const updates = [];
  const params = [];
  for (const field of EDITABLE_FIELDS) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(req.body[field]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar.' });

  updates.push("updated_at = datetime('now')");
  params.push(req.params.id);

  db.prepare(`UPDATE companies SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const updated = withComputed(db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id));

  broadcast('company:updated', { id: updated.id });
  res.json(updated);
});

// DELETE /api/companies/:id - remove uma empresa e tudo ligado a ela
// (obrigações e parcelamentos). Só admin, para evitar remoções acidentais.
router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const removeAll = db.transaction(() => {
    if (company.codigo !== null) {
      db.prepare('DELETE FROM company_obligations WHERE codigo = ?').run(company.codigo);
    }
    const cnpjNorm = onlyDigits(company.cnpj);
    if (cnpjNorm) {
      db.prepare('DELETE FROM company_installments WHERE cnpj_normalizado = ?').run(cnpjNorm);
    }
    db.prepare('DELETE FROM companies WHERE id = ?').run(req.params.id);
  });
  removeAll();

  broadcast('company:deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
});

// PATCH /api/companies/:id/obligations/:tipo - edita os itens de uma
// obrigação (Municipal/Estadual/Federal/Anual) direto pela Ficha.
// body: { itens: [{ label, value }, ...] }
router.patch('/:id/obligations/:tipo', requireAuth, (req, res) => {
  const tipo = req.params.tipo;
  if (!OBLIGATION_TITLES[tipo]) return res.status(400).json({ error: 'Tipo de obrigação inválido.' });

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const itens = Array.isArray(req.body.itens) ? req.body.itens : null;
  if (!itens) return res.status(400).json({ error: 'Envie "itens" como uma lista.' });

  const dataJson = JSON.stringify(
    itens.map((i) => ({ label: String(i.label || '').trim(), value: i.value ? String(i.value).trim() : null }))
  );

  db.prepare(`
    INSERT INTO company_obligations (codigo, cnpj, tipo, data_json, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(codigo, tipo) DO UPDATE SET data_json = excluded.data_json, updated_at = datetime('now')
  `).run(company.codigo, company.cnpj, tipo, dataJson);

  broadcast('company:updated', { id: company.id });
  res.json({ ok: true });
});

// PATCH /api/companies/:id/installments/:tipo - edita um parcelamento
// (ativo ou encerrado) direto pela Ficha.
// body: { situacao, forma_envio, usuario, observacoes, flags: [{label, active}] }
router.patch('/:id/installments/:tipo', requireAuth, (req, res) => {
  const tipo = req.params.tipo;
  if (tipo !== 'ativo' && tipo !== 'encerrado') return res.status(400).json({ error: 'Tipo inválido.' });

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const cnpjNorm = onlyDigits(company.cnpj);
  if (!cnpjNorm) {
    return res.status(400).json({ error: 'Esta empresa não tem CNPJ cadastrado — cadastre o CNPJ antes de registrar parcelamentos.' });
  }

  const flags = Array.isArray(req.body.flags) ? req.body.flags : [];
  const flagsJson = JSON.stringify(
    flags.filter((f) => f.active).map((f) => ({ label: String(f.label || '').trim(), active: true }))
  );

  db.prepare(`
    INSERT INTO company_installments (
      cnpj, cnpj_normalizado, razao_social, tipo, situacao, forma_envio, usuario, flags_json, observacoes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(cnpj_normalizado, tipo) DO UPDATE SET
      situacao = excluded.situacao,
      forma_envio = excluded.forma_envio,
      usuario = excluded.usuario,
      flags_json = excluded.flags_json,
      observacoes = excluded.observacoes,
      updated_at = datetime('now')
  `).run(
    company.cnpj,
    cnpjNorm,
    company.razao_social,
    tipo,
    req.body.situacao || null,
    req.body.forma_envio || null,
    req.body.usuario || null,
    flagsJson,
    req.body.observacoes || null
  );

  broadcast('company:updated', { id: company.id });
  res.json({ ok: true });
});

module.exports = router;
