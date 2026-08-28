const express = require('express');
const db = require('../db/init');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/tax-regimes - lista os regimes disponíveis
router.get('/', requireAuth, (req, res) => {
  const regimes = db.prepare('SELECT nome FROM tax_regimes ORDER BY nome').all();
  res.json(regimes.map((r) => r.nome));
});

// POST /api/tax-regimes - adiciona um novo regime à lista (admin)
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const nome = (req.body.nome || '').trim();
  if (!nome) return res.status(400).json({ error: 'Informe o nome do regime.' });

  db.prepare('INSERT OR IGNORE INTO tax_regimes (nome) VALUES (?)').run(nome);
  const regimes = db.prepare('SELECT nome FROM tax_regimes ORDER BY nome').all();
  res.status(201).json(regimes.map((r) => r.nome));
});

module.exports = router;
