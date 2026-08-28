const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db/init');
const { requireAuth, requireRole } = require('../middleware/auth');
const { broadcast } = require('../realtime/ws');
const { createClientFolders, extractCodigoFromFolderName } = require('../lib/folder-template');

const router = express.Router();

function watchedRoot() {
  return path.resolve(process.env.WATCHED_FOLDER || path.join(__dirname, '..', 'watched-files'));
}

// Garante que o caminho pedido não escapa da pasta monitorada (protege
// contra "../../etc/passwd" e afins).
function resolveSafePath(relativePath) {
  const root = watchedRoot();
  const target = path.resolve(root, relativePath || '');
  if (target !== root && !target.startsWith(root + path.sep)) {
    const err = new Error('Caminho inválido.');
    err.code = 'INVALID_PATH';
    throw err;
  }
  return target;
}

function getDefaultTemplate() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('folder_template');
  return row ? JSON.parse(row.value) : { setores: [], extras: [] };
}

// GET /api/directories?path=<relativo> - navega pela pasta monitorada
router.get('/', requireAuth, (req, res) => {
  let target;
  try {
    target = resolveSafePath(req.query.path || '');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!fs.existsSync(target)) {
    return res.status(404).json({ error: 'Pasta não encontrada. Ela pode ter sido movida ou removida.' });
  }

  const entries = fs.readdirSync(target, { withFileTypes: true });
  const items = entries.map((entry) => {
    const fullPath = path.join(target, entry.name);
    let stat = null;
    try {
      stat = fs.statSync(fullPath);
    } catch (e) {
      // arquivo pode ter sido removido entre o readdir e o stat — ignora
    }
    return {
      name: entry.name,
      type: entry.isDirectory() ? 'dir' : 'file',
      size: stat && !entry.isDirectory() ? stat.size : null,
      mtime: stat ? stat.mtime.toISOString() : null,
    };
  });

  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });

  // No nível raiz, tenta casar cada pasta com uma empresa pelo código no
  // início do nome (ex: "123-empresa_x" -> código 123), pra já mostrar de
  // quem é cada pasta sem precisar abrir.
  const isRoot = !req.query.path;
  if (isRoot) {
    const companiesByCodigo = new Map(
      db.prepare('SELECT codigo, razao_social, status_code FROM companies WHERE codigo IS NOT NULL').all().map((c) => [c.codigo, c])
    );
    items.forEach((item) => {
      if (item.type === 'dir') {
        const codigo = extractCodigoFromFolderName(item.name);
        const company = codigo !== null ? companiesByCodigo.get(codigo) : null;
        item.company = company ? { codigo: company.codigo, razao_social: company.razao_social } : null;
        item.unmatched = codigo !== null && !company;
      }
    });
  }

  res.json({ path: req.query.path || '', items, watched_folder: watchedRoot() });
});

// GET /api/directories/download?path=<relativo>&token=... - baixa um arquivo
router.get('/download', requireAuth, (req, res) => {
  let target;
  try {
    target = resolveSafePath(req.query.path || '');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }
  res.download(target, path.basename(target));
});

// GET /api/directories/template - modelo padrão de pastas (global)
router.get('/template', requireAuth, (req, res) => {
  res.json(getDefaultTemplate());
});

// PUT /api/directories/template - edita o modelo padrão (admin)
router.put('/template', requireAuth, requireRole('admin'), (req, res) => {
  const { setores, extras } = req.body;
  if (!Array.isArray(setores)) return res.status(400).json({ error: 'Envie "setores" como lista.' });

  const value = JSON.stringify({ setores, extras: Array.isArray(extras) ? extras : [] });
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('folder_template', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(value);

  broadcast('directories:template_updated', {});
  res.json({ ok: true });
});

// GET /api/directories/template/:codigo - modelo específico de uma empresa
// (se não houver personalização, devolve o modelo padrão)
router.get('/template/:codigo', requireAuth, (req, res) => {
  const row = db.prepare('SELECT structure_json FROM company_folder_templates WHERE codigo = ?').get(req.params.codigo);
  if (row) return res.json({ ...JSON.parse(row.structure_json), personalizado: true });
  res.json({ ...getDefaultTemplate(), personalizado: false });
});

// PUT /api/directories/template/:codigo - personaliza o modelo de uma empresa
router.put('/template/:codigo', requireAuth, (req, res) => {
  const { setores, extras } = req.body;
  if (!Array.isArray(setores)) return res.status(400).json({ error: 'Envie "setores" como lista.' });

  const value = JSON.stringify({ setores, extras: Array.isArray(extras) ? extras : [] });
  db.prepare(`
    INSERT INTO company_folder_templates (codigo, structure_json, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(codigo) DO UPDATE SET structure_json = excluded.structure_json, updated_at = datetime('now')
  `).run(req.params.codigo, value);

  res.json({ ok: true });
});

// DELETE /api/directories/template/:codigo - remove a personalização
// (volta a usar o modelo padrão)
router.delete('/template/:codigo', requireAuth, (req, res) => {
  db.prepare('DELETE FROM company_folder_templates WHERE codigo = ?').run(req.params.codigo);
  res.json({ ok: true });
});

// POST /api/directories/create-for-company/:companyId - cria a estrutura de
// pastas de uma empresa (matriz ou filial) dentro da pasta monitorada
router.post('/create-for-company/:companyId', requireAuth, (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const ano = req.body.ano || new Date().getFullYear();
  const filial = req.body.filial || null;

  const customRow = db.prepare('SELECT structure_json FROM company_folder_templates WHERE codigo = ?').get(company.codigo);
  const template = customRow ? JSON.parse(customRow.structure_json) : getDefaultTemplate();

  try {
    const result = createClientFolders({ watchedFolder: watchedRoot(), company, ano, filial, template });
    broadcast('directories:changed', {});
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: `Não foi possível criar as pastas: ${err.message}` });
  }
});

module.exports = router;
