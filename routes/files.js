const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/init');
const { requireAuth } = require('../middleware/auth');
const { broadcast } = require('../realtime/ws');

const router = express.Router();
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

// Salva os arquivos em uploads/<task_id>/<timestamp>-<nome-original>
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const taskDir = path.join(UPLOAD_ROOT, String(req.params.taskId));
    fs.mkdirSync(taskDir, { recursive: true });
    cb(null, taskDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB por arquivo

// GET /api/tasks/:taskId/files - lista arquivos de uma tarefa
router.get('/:taskId/files', requireAuth, (req, res) => {
  const files = db
    .prepare('SELECT id, original_name, uploaded_by, uploaded_at FROM files WHERE task_id = ? ORDER BY uploaded_at DESC')
    .all(req.params.taskId);
  res.json(files);
});

// POST /api/tasks/:taskId/files - envia um arquivo para o servidor, vinculado à tarefa
router.post('/:taskId/files', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.taskId);
  if (!task) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Tarefa não encontrada.' });
  }

  const info = db
    .prepare(
      'INSERT INTO files (task_id, filename, original_name, uploaded_by) VALUES (?, ?, ?, ?)'
    )
    .run(req.params.taskId, req.file.filename, req.file.originalname, req.user.id);

  broadcast('task:files_changed', { task_id: Number(req.params.taskId) });
  res.status(201).json({ id: info.lastInsertRowid, original_name: req.file.originalname });
});

// GET /api/tasks/:taskId/files/:fileId/download - baixa um arquivo do servidor
router.get('/:taskId/files/:fileId/download', requireAuth, (req, res) => {
  const file = db
    .prepare('SELECT * FROM files WHERE id = ? AND task_id = ?')
    .get(req.params.fileId, req.params.taskId);
  if (!file) return res.status(404).json({ error: 'Arquivo não encontrado.' });

  // Arquivos indexados (vinculados da pasta do servidor) ficam no caminho
  // original; arquivos enviados via upload ficam em uploads/<task_id>/
  const filePath =
    file.source === 'indexed' && file.source_path
      ? file.source_path
      : path.join(UPLOAD_ROOT, String(req.params.taskId), file.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo não encontrado no servidor.' });
  }

  res.download(filePath, file.original_name);
});

// DELETE /api/tasks/:taskId/files/:fileId - remove um arquivo (quem enviou ou admin)
router.delete('/:taskId/files/:fileId', requireAuth, (req, res) => {
  const file = db
    .prepare('SELECT * FROM files WHERE id = ? AND task_id = ?')
    .get(req.params.fileId, req.params.taskId);
  if (!file) return res.status(404).json({ error: 'Arquivo não encontrado.' });

  if (req.user.role !== 'admin' && file.uploaded_by !== req.user.id) {
    return res.status(403).json({ error: 'Somente quem enviou o arquivo ou um administrador pode removê-lo.' });
  }

  if (file.source === 'indexed' && file.source_path) {
    // Arquivo indexado: só desvincula, nunca apaga o arquivo original do servidor
    db.prepare('UPDATE indexed_files SET linked_task_id = NULL WHERE source_path = ?').run(file.source_path);
  } else {
    const filePath = path.join(UPLOAD_ROOT, String(req.params.taskId), file.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  db.prepare('DELETE FROM files WHERE id = ?').run(req.params.fileId);

  broadcast('task:files_changed', { task_id: Number(req.params.taskId) });
  res.json({ ok: true });
});

module.exports = router;
