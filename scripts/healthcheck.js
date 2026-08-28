// Diagnóstico rápido: verifica se tudo que o servidor precisa está
// funcionando ANTES de tentar iniciar de verdade. Isso evita que um erro
// técnico confuso apareça (ou que a janela feche rápido demais pra ler) e
// mostra exatamente o que precisa ser corrigido, em português.
//
// Uso: node scripts/healthcheck.js
// Sai com código 0 se tudo estiver OK, ou 1 se algo estiver faltando.

const checks = [];
let allOk = true;

function check(label, fn) {
  try {
    fn();
    checks.push({ label, ok: true });
  } catch (err) {
    allOk = false;
    const firstLine = (err.message || String(err)).split('\n')[0];
    checks.push({ label, ok: false, error: firstLine });
  }
}

console.log('Verificando dependências do sistema...\n');

check('Node.js (versão)', () => {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 22) {
    throw new Error(
      `Versão ${process.versions.node} é anterior à 22. Este sistema precisa do Node 22 ou mais recente ` +
      `(o banco de dados usa o módulo "node:sqlite", disponível a partir do Node 22).`
    );
  }
});

check('express (servidor web)', () => require('express'));
check('cors', () => require('cors'));
check('dotenv', () => require('dotenv'));
check('bcryptjs (senhas)', () => require('bcryptjs'));
check('jsonwebtoken (login)', () => require('jsonwebtoken'));
check('multer (upload de arquivos)', () => require('multer'));
check('ws (sincronia em tempo real)', () => require('ws'));
check('chokidar (monitorar pasta do servidor)', () => require('chokidar'));
check('xlsx (importar planilha Excel)', () => require('xlsx'));

// O banco de dados usa "node:sqlite", que já vem embutido no próprio
// Node.js — não é um módulo separado que precisa compilar ou baixar
// binário, então não sofre dos problemas de compatibilidade que módulos
// nativos de terceiros (como o antigo better-sqlite3) podiam ter. Mesmo
// assim, testamos de verdade (criar tabela, inserir, ler, transação) para
// garantir que está tudo funcionando nesta instalação do Node.
check('node:sqlite (banco de dados)', () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE t (id INTEGER, nome TEXT)');
  const insert = db.prepare('INSERT INTO t (id, nome) VALUES (?, ?)');
  db.exec('BEGIN');
  for (let i = 0; i < 200; i++) insert.run(i, 'teste ' + i);
  db.exec('COMMIT');
  const row = db.prepare('SELECT COUNT(*) AS c FROM t').get();
  if (row.c !== 200) throw new Error('Contagem de linhas inesperada após inserção em lote.');
  db.close();
});

// Relatório
checks.forEach((c) => {
  if (c.ok) {
    console.log(`  [OK] ${c.label}`);
  } else {
    console.log(`  [FALHOU] ${c.label}`);
    console.log(`           ${c.error}`);
  }
});

console.log('');

if (!allOk) {
  console.log('========================================');
  console.log('Alguns componentes não estão funcionando.');
  console.log('========================================\n');

  const missingModules = checks.filter((c) => !c.ok && c.error.includes('Cannot find module'));
  if (missingModules.length > 0) {
    console.log('Alguns pacotes ainda não foram instalados. Rode:');
    console.log('  npm install\n');
  }

  const nodeFailed = checks.find((c) => c.label.includes('Node.js') && !c.ok);
  if (nodeFailed) {
    console.log('Instale o Node.js 22 ou mais recente em https://nodejs.org');
    console.log('(clique no botão "LTS") e rode este arquivo de novo depois.\n');
  }

  process.exit(1);
} else {
  console.log('Tudo certo! Pode iniciar o servidor normalmente.');
  process.exit(0);
}
