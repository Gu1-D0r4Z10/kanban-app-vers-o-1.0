// Importa RESPONSÁVEIS (usuários) e TAREFAS a partir da aba "Empresas" da
// planilha — a única aba que tem, por linha, um responsável + prazo +
// status real e individual por empresa (as abas de obrigações fiscais são
// uma matriz de status, não registros de tarefa com responsável próprio).
//
// IMPORTANTE — o que é fiel à planilha e o que é decisão do sistema:
//   FIEL À PLANILHA: nome do responsável, empresa vinculada, prazo (Data
//   Limite), status (Acompanhamento) e a competência derivada do prazo.
//   DECISÃO DO SISTEMA (a planilha não tem essas colunas, então nada disso
//   finge vir dela): a planilha não tem uma coluna de "nome da tarefa", por
//   isso todo item importado usa o título neutro "Obrigação mensal"; o tipo
//   de tarefa é sempre "obrigacao_acessoria"; e-mails de responsáveis novos
//   usam o domínio de exemplo "@empresa.local" com senha temporária gerada.

const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const db = require('../db/init');

function cellToText(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return text === '' ? null : text;
}

function toIntOrNull(value) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

function randomTempPassword() {
  return Math.random().toString(36).slice(-6) + Math.random().toString(36).slice(-4).toUpperCase();
}

function readEmpresasRows(workbookSource) {
  const workbook =
    typeof workbookSource === 'string'
      ? XLSX.readFile(workbookSource, { cellDates: true })
      : XLSX.read(workbookSource, { type: 'buffer', cellDates: true });

  if (!workbook.SheetNames.includes('Empresas')) {
    const err = new Error('A aba "Empresas" não foi encontrada nesta planilha.');
    err.code = 'SHEET_NOT_FOUND';
    throw err;
  }
  return XLSX.utils.sheet_to_json(workbook.Sheets['Empresas'], { defval: null, raw: true });
}

// Cria uma conta de usuário para cada responsável distinto que aparece na
// planilha e ainda não existe no sistema (comparação por nome, sem
// diferenciar maiúsculas/acentos/espaços nas pontas).
function importResponsaveis(workbookSource) {
  const rows = readEmpresasRows(workbookSource);

  const existingUsers = db.prepare('SELECT id, name FROM users').all();
  const existingNames = new Set(existingUsers.map((u) => u.name.trim().toLowerCase()));
  const existingEmails = new Set(db.prepare('SELECT email FROM users').all().map((u) => u.email.toLowerCase()));

  const distinctNames = new Set();
  for (const row of rows) {
    const nome = cellToText(row['Usuário']);
    if (nome) distinctNames.add(nome);
  }

  const created = [];
  const insertUser = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');

  for (const nome of distinctNames) {
    if (existingNames.has(nome.trim().toLowerCase())) continue;

    let emailBase = slugify(nome) || 'usuario';
    let email = `${emailBase}@empresa.local`;
    let suffix = 2;
    while (existingEmails.has(email)) {
      email = `${emailBase}${suffix}@empresa.local`;
      suffix++;
    }
    existingEmails.add(email);

    const tempPassword = randomTempPassword();
    const hash = bcrypt.hashSync(tempPassword, 10);
    insertUser.run(nome, email, hash, 'member');
    existingNames.add(nome.trim().toLowerCase());

    created.push({ name: nome, email, tempPassword });
  }

  return { created };
}

// Mapeia o "Acompanhamento" da planilha (texto real da célula) para o
// status/prioridade do quadro — preservando o significado original:
// já entregue -> Concluído; em andamento -> Em Andamento; ainda pendente
// (nunca iniciada ou atrasada) -> A Fazer, com prioridade alta se atrasada.
function mapAcompanhamento(acompanhamento) {
  const a = (acompanhamento || '').trim();
  if (a === 'Entregue' || a === 'Entregue com Atraso') return { status: 'done', priority: 'media' };
  if (a === 'Em Andamento') return { status: 'doing', priority: 'media' };
  if (a === 'Em Atraso') return { status: 'todo', priority: 'alta' };
  return { status: 'todo', priority: 'media' }; // "Não Inicializada" ou vazio
}

function competenciaFromDate(dateVal) {
  const text = cellToText(dateVal);
  if (text && /^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(0, 7);
  return new Date().toISOString().slice(0, 7);
}

// Cria uma tarefa por empresa, só para linhas que têm responsável definido
// na planilha (sem responsável real, não há como vincular sem inventar).
// Não duplica em reimportações: cada empresa só gera uma tarefa importada.
function importTasks(workbookSource) {
  const rows = readEmpresasRows(workbookSource);

  const adminUser = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  const systemUserId = adminUser ? adminUser.id : null;

  const insertTask = db.prepare(`
    INSERT INTO tasks (
      title, description, status, priority, assignee_id, due_date,
      tipo_tarefa, competencia, company_id, created_by
    ) VALUES ('Obrigação mensal', ?, ?, ?, ?, ?, 'obrigacao_acessoria', ?, ?, ?)
  `);

  let created = 0;
  let skippedNoResponsavel = 0;
  let skippedAlreadyImported = 0;
  let skippedNoCompany = 0;

  const importAll = db.transaction((rows) => {
    for (const row of rows) {
      const codigo = toIntOrNull(row['Código']);
      const razaoSocial = cellToText(row['Razão Social']);
      const usuario = cellToText(row['Usuário']);
      if (codigo === null || !razaoSocial) continue;

      if (!usuario) {
        skippedNoResponsavel++;
        continue;
      }

      const company = db.prepare('SELECT id FROM companies WHERE codigo = ?').get(codigo);
      if (!company) {
        skippedNoCompany++;
        continue;
      }

      const alreadyImported = db
        .prepare("SELECT id FROM tasks WHERE company_id = ? AND title = 'Obrigação mensal'")
        .get(company.id);
      if (alreadyImported) {
        skippedAlreadyImported++;
        continue;
      }

      const user = db.prepare('SELECT id FROM users WHERE lower(trim(name)) = ?').get(usuario.trim().toLowerCase());
      const { status, priority } = mapAcompanhamento(row['Acompanhamento']);
      const dueDate = cellToText(row['Data Limite']);
      const competencia = competenciaFromDate(row['Data Limite']);
      const description = `Importado da planilha — Acompanhamento original: "${cellToText(row['Acompanhamento']) || '—'}".`;

      insertTask.run(description, status, priority, user ? user.id : null, dueDate, competencia, company.id, systemUserId);
      created++;
    }
  });

  importAll(rows);

  return { created, skippedNoResponsavel, skippedAlreadyImported, skippedNoCompany };
}

module.exports = { importResponsaveis, importTasks };
