const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db/init');
const { requireAuth, requireRole } = require('../middleware/auth');
const { broadcast } = require('../realtime/ws');

const router = express.Router();

function watchedRoot() {
  return path.resolve(process.env.WATCHED_FOLDER || path.join(__dirname, '..', 'watched-files'));
}

const TASK_TYPES = ['imposto', 'parcelamento', 'declaracao', 'obrigacao_acessoria', 'administrativa', 'outros'];

// Verifica se existe algum arquivo na pasta relacionada que bata com o
// padrão esperado (aceita "*" como curinga; sem "*", compara por trecho do
// nome, sem diferenciar maiúsculas/minúsculas).
function findMatchingFile(pastaRelacionada, padrao) {
  const dir = path.join(watchedRoot(), pastaRelacionada || '');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { found: false, reason: `A pasta "${pastaRelacionada}" não foi encontrada na pasta monitorada do servidor.` };
  }

  const files = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
  if (!padrao) return { found: files.length > 0, reason: files.length ? null : 'A pasta está vazia — nenhum arquivo encontrado.' };

  const regex = new RegExp('^' + padrao.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
  const match = files.find((f) => regex.test(f) || f.toLowerCase().includes(padrao.toLowerCase()));
  return { found: !!match, reason: match ? null : `Nenhum arquivo em "${pastaRelacionada}" bate com o padrão "${padrao}".`, matchedFile: match };
}

function taskWithNames(task) {
  const assignee = task.assignee_id
    ? db.prepare('SELECT id, name FROM users WHERE id = ?').get(task.assignee_id)
    : null;
  const company = task.company_id
    ? db.prepare('SELECT id, codigo, razao_social, tributacao, usuario FROM companies WHERE id = ?').get(task.company_id)
    : null;
  const fileCount = db
    .prepare('SELECT COUNT(*) AS c FROM files WHERE task_id = ?')
    .get(task.id).c;
  return {
    ...task,
    assignee_name: assignee ? assignee.name : null,
    company_codigo: company ? company.codigo : null,
    company_razao_social: company ? company.razao_social : null,
    file_count: fileCount,
  };
}

// Calcula a próxima data a partir de uma data base, segundo o tipo/intervalo
// de recorrência ('daily'|'weekly'|'monthly'|'yearly', a cada N unidades).
function nextDueDate(baseDateStr, type, interval) {
  const base = baseDateStr ? new Date(baseDateStr + 'T00:00:00') : new Date();
  const n = Math.max(1, Number(interval) || 1);

  if (type === 'daily') base.setDate(base.getDate() + n);
  else if (type === 'weekly') base.setDate(base.getDate() + n * 7);
  else if (type === 'monthly') base.setMonth(base.getMonth() + n);
  else if (type === 'yearly') base.setFullYear(base.getFullYear() + n);
  else return null;

  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Próxima competência (mês/ano) a partir de "YYYY-MM", avançando 1 mês —
// usada quando uma tarefa recorrente mensal gera a próxima ocorrência.
function nextCompetencia(competencia) {
  if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)) return competencia;
  const [y, m] = competencia.split('-').map(Number);
  const date = new Date(y, m - 1 + 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Quando uma tarefa recorrente é concluída, gera automaticamente a próxima
// ocorrência (nova tarefa, em "A Fazer", com o prazo já calculado).
function spawnNextOccurrence(task) {
  if (!task.recurrence_type || task.recurrence_type === 'none') return null;

  const newDueDate = nextDueDate(task.due_date, task.recurrence_type, task.recurrence_interval);
  const info = db
    .prepare(
      `INSERT INTO tasks (
         title, description, status, priority, assignee_id, due_date,
         recurrence_type, recurrence_interval, recurrence_parent_id,
         tipo_tarefa, competencia, requer_arquivo, arquivo_padrao, pasta_relacionada, company_id, created_by
       ) VALUES (?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      task.title,
      task.description,
      task.priority,
      task.assignee_id,
      newDueDate,
      task.recurrence_type,
      task.recurrence_interval,
      task.recurrence_parent_id || task.id,
      task.tipo_tarefa,
      task.recurrence_type === 'monthly' ? nextCompetencia(task.competencia) : task.competencia,
      task.requer_arquivo,
      task.arquivo_padrao,
      task.pasta_relacionada,
      task.company_id,
      task.created_by
    );

  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
}

const RECURRENCE_TYPES = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

// GET /api/tasks - lista tarefas, com filtros opcionais
router.get('/', requireAuth, (req, res) => {
  const { assignee, priority, tipo, competencia, company_id } = req.query;
  let query = 'SELECT * FROM tasks WHERE 1=1';
  const params = [];

  if (assignee) {
    query += ' AND assignee_id = ?';
    params.push(assignee);
  }
  if (priority) {
    query += ' AND priority = ?';
    params.push(priority);
  }
  if (tipo) {
    query += ' AND tipo_tarefa = ?';
    params.push(tipo);
  }
  if (competencia) {
    query += ' AND competencia = ?';
    params.push(competencia);
  }
  if (company_id) {
    query += ' AND company_id = ?';
    params.push(company_id);
  }
  query += ' ORDER BY created_at DESC';

  const tasks = db.prepare(query).all(...params).map(taskWithNames);
  res.json(tasks);
});

// POST /api/tasks - cria nova tarefa
router.post('/', requireAuth, (req, res) => {
  const {
    title, description = '', priority = 'media', assignee_id = null, due_date = null,
    recurrence_type = 'none', recurrence_interval = 1,
    tipo_tarefa = 'outros', competencia = null,
    requer_arquivo = false, arquivo_padrao = null, pasta_relacionada = null,
    company_id = null,
  } = req.body;
  if (!title) return res.status(400).json({ error: 'Título é obrigatório.' });

  const recType = RECURRENCE_TYPES.includes(recurrence_type) ? recurrence_type : 'none';
  const recInterval = Math.max(1, Number(recurrence_interval) || 1);
  const tipo = TASK_TYPES.includes(tipo_tarefa) ? tipo_tarefa : 'outros';
  const comp = competencia || new Date().toISOString().slice(0, 7);

  const info = db
    .prepare(
      `INSERT INTO tasks (
         title, description, priority, assignee_id, due_date, recurrence_type, recurrence_interval,
         tipo_tarefa, competencia, requer_arquivo, arquivo_padrao, pasta_relacionada, company_id, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(title, description, priority, assignee_id, due_date, recType, recInterval, tipo, comp, requer_arquivo ? 1 : 0, arquivo_padrao, pasta_relacionada, company_id, req.user.id);

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
  broadcast('task:created', { id: task.id });
  res.status(201).json(taskWithNames(task));
});

// PATCH /api/tasks/:id - atualiza campos da tarefa (status, prioridade, responsável, etc.)
router.patch('/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });

  // Se a tarefa exige arquivo para ser concluída, verifica antes de deixar
  // mudar o status para "done" — sem o arquivo certo, a conclusão é barrada.
  if (req.body.status === 'done' && task.status !== 'done' && task.requer_arquivo) {
    const check = findMatchingFile(task.pasta_relacionada, task.arquivo_padrao);
    if (!check.found) {
      return res.status(422).json({
        error: `Esta tarefa exige um arquivo para ser concluída. ${check.reason}`,
        code: 'MISSING_REQUIRED_FILE',
      });
    }
  }

  const fields = [
    'title', 'description', 'status', 'priority', 'assignee_id', 'due_date',
    'recurrence_type', 'recurrence_interval', 'tipo_tarefa', 'competencia',
    'requer_arquivo', 'arquivo_padrao', 'pasta_relacionada', 'company_id',
  ];
  const updates = [];
  const params = [];

  for (const f of fields) {
    if (req.body[f] !== undefined) {
      if (f === 'recurrence_type' && !RECURRENCE_TYPES.includes(req.body[f])) continue;
      if (f === 'tipo_tarefa' && !TASK_TYPES.includes(req.body[f])) continue;
      let value = req.body[f];
      if (f === 'requer_arquivo') value = value ? 1 : 0;
      updates.push(`${f} = ?`);
      params.push(value);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar.' });

  updates.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  broadcast('task:updated', { id: updated.id });

  // Se a tarefa acabou de ser movida para "Concluído" (e não já estava lá) e
  // é recorrente, gera automaticamente a próxima ocorrência em "A Fazer".
  let spawned = null;
  if (req.body.status === 'done' && task.status !== 'done') {
    spawned = spawnNextOccurrence(updated);
    if (spawned) broadcast('task:created', { id: spawned.id });
  }

  res.json({ ...taskWithNames(updated), spawned_task_id: spawned ? spawned.id : null });
});

// DELETE /api/tasks/:id - remove tarefa (autor da tarefa ou admin)
router.delete('/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });

  if (req.user.role !== 'admin' && task.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Somente o autor da tarefa ou um administrador pode excluí-la.' });
  }

  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  broadcast('task:deleted', { id: Number(id) });
  res.json({ ok: true });
});

module.exports = router;
