const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/init');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/users - lista usuários (qualquer pessoa logada pode ver para atribuir tarefas)
router.get('/', requireAuth, (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY name').all();
  res.json(users);
});

// POST /api/users - cria novo usuário (somente admin)
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nome, email e senha são obrigatórios.' });
  }
  const finalRole = role === 'admin' ? 'admin' : 'member';

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'Já existe um usuário com esse email.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, email.toLowerCase(), hash, finalRole);

  res.status(201).json({ id: info.lastInsertRowid, name, email, role: finalRole });
});

// PATCH /api/users/:id - atualiza papel (role) ou senha de um usuário (somente admin)
router.patch('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const { role, password } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  if (role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role === 'admin' ? 'admin' : 'member', id);
  }
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  }

  res.json({ ok: true });
});

// DELETE /api/users/:id - remove usuário (somente admin, não pode remover a si mesmo)
router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: 'Você não pode remover seu próprio usuário.' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
