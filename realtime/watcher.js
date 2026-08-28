// Indexação reversa: monitora uma pasta do servidor (WATCHED_FOLDER) e
// mantém a tabela indexed_files sincronizada com o que existe fisicamente
// no disco. Quando um arquivo aparece, some, ou é modificado, atualiza o
// banco e avisa os navegadores conectados em tempo real via WebSocket.

const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const db = require('../db/init');
const { broadcast } = require('./ws');

function start(watchedFolder) {
  const rootPath = path.resolve(watchedFolder);
  fs.mkdirSync(rootPath, { recursive: true });

  const upsert = db.prepare(`
    INSERT INTO indexed_files (relative_path, absolute_path, filename, size, mtime, last_seen_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(relative_path) DO UPDATE SET
      absolute_path = excluded.absolute_path,
      size = excluded.size,
      mtime = excluded.mtime,
      last_seen_at = datetime('now')
  `);

  const remove = db.prepare('DELETE FROM indexed_files WHERE relative_path = ?');

  const watcher = chokidar.watch(rootPath, {
    ignoreInitial: false, // faz a varredura inicial de tudo que já existe na pasta
    persistent: true,
    depth: 10,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }, // espera o arquivo terminar de ser copiado
  });

  watcher.on('add', (absolutePath, stats) => {
    const relativePath = path.relative(rootPath, absolutePath);
    upsert.run(
      relativePath,
      absolutePath,
      path.basename(absolutePath),
      stats ? stats.size : null,
      stats ? stats.mtime.toISOString() : null
    );
    broadcast('indexed_file:added', { relative_path: relativePath, filename: path.basename(absolutePath) });
  });

  watcher.on('change', (absolutePath, stats) => {
    const relativePath = path.relative(rootPath, absolutePath);
    upsert.run(
      relativePath,
      absolutePath,
      path.basename(absolutePath),
      stats ? stats.size : null,
      stats ? stats.mtime.toISOString() : null
    );
    broadcast('indexed_file:changed', { relative_path: relativePath });
  });

  watcher.on('unlink', (absolutePath) => {
    const relativePath = path.relative(rootPath, absolutePath);
    remove.run(relativePath);
    broadcast('indexed_file:removed', { relative_path: relativePath });
  });

  // Pastas criadas/removidas (ex: pela padronização de pastas de cliente, ou
  // manualmente) não são gravadas em banco — a aba "Diretórios" lê a pasta
  // ao vivo. Só avisamos os navegadores conectados para atualizarem a vista.
  watcher.on('addDir', () => broadcast('directories:changed', {}));
  watcher.on('unlinkDir', () => broadcast('directories:changed', {}));

  watcher.on('error', (err) => {
    console.error('Erro ao monitorar a pasta do servidor:', err.message);
  });

  watcher.on('ready', () => {
    console.log(`Indexação reversa ativa. Monitorando: ${rootPath}`);
  });

  return watcher;
}

module.exports = { start };
