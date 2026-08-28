const express = require('express');
const db = require('../db/init');
const { requireAuth } = require('../middleware/auth');
const { broadcast } = require('../realtime/ws');

const router = express.Router();

// GET /api/indexed-files - lista arquivos encontrados na pasta monitorada
// ?unlinked=1 mostra apenas os que ainda não foram vinculados a nenhuma tarefa
router.get('/', requireAuth, (req, res) => {
  let query = 'SELECT * FROM indexed_files';
  if (req.query.unlinked === '1') query += ' WHERE linked_task_id IS NULL';
  query += ' ORDER BY last_seen_at DESC';
  res.json(db.prepare(query).all());
});

// POST /api/indexed-files/:id/link - vincula um arquivo indexado a uma tarefa
// (não copia o arquivo, apenas referencia o caminho original no servidor)
router.post('/:id/link', requireAuth, (req, res) => {
  const { task_id } = req.body;
  if (!task_id) return res.status(400).json({ error: 'Informe task_id.' });

  const indexed = db.prepare('SELECT * FROM indexed_files WHERE id = ?').get(req.params.id);
  if (!indexed) return res.status(404).json({ error: 'Arquivo indexado não encontrado.' });

  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(task_id);
  if (!task) return res.status(404).json({ error: 'Tarefa não encontrada.' });

  db.prepare('UPDATE indexed_files SET linked_task_id = ? WHERE id = ?').run(task_id, indexed.id);

  const info = db
    .prepare(
      `INSERT INTO files (task_id, filename, original_name, uploaded_by, source, source_path)
       VALUES (?, ?, ?, ?, 'indexed', ?)`
    )
    .run(task_id, indexed.filename, indexed.filename, req.user.id, indexed.absolute_path);

  broadcast('task:files_changed', { task_id: Number(task_id) });
  res.status(201).json({ id: info.lastInsertRowid, original_name: indexed.filename });
});

// POST /api/indexed-files/:id/unlink - desvincula (não apaga o arquivo do servidor)
router.post('/:id/unlink', requireAuth, (req, res) => {
  const indexed = db.prepare('SELECT * FROM indexed_files WHERE id = ?').get(req.params.id);
  if (!indexed) return res.status(404).json({ error: 'Arquivo indexado não encontrado.' });

  const taskId = indexed.linked_task_id;
  db.prepare('UPDATE indexed_files SET linked_task_id = NULL WHERE id = ?').run(indexed.id);
  db.prepare("DELETE FROM files WHERE source = 'indexed' AND source_path = ?").run(indexed.absolute_path);

  if (taskId) broadcast('task:files_changed', { task_id: taskId });
  res.json({ ok: true });
});

module.exports = router;
