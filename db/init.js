// Inicializa o banco de dados SQLite (arquivo local: db/kanban.db)
// Cria as tabelas se não existirem e garante um usuário administrador inicial.
//
// IMPORTANTE: usamos o módulo "node:sqlite", que já vem embutido no próprio
// Node.js (a partir da versão 22) — nada para compilar, nenhum binário
// separado para baixar. Isso evita os crashes nativos que aconteciam com
// bibliotecas de terceiros (ex: better-sqlite3) em certas combinações de
// Node/Windows, já que aqui o SQLite faz parte do próprio Node instalado.

require('dotenv').config();
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'kanban.db');
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// O node:sqlite não tem o método de conveniência ".transaction()" que o
// better-sqlite3 tinha. Recriamos o mesmo comportamento aqui — o resto do
// código usa "db.transaction(fn)" exatamente como antes, sem precisar mudar
// nada em cada arquivo que já usava esse padrão.
db.transaction = function (fn) {
  return function (...args) {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch (rollbackErr) {
        // ignora — se o ROLLBACK falhar, o erro original é o que importa
      }
      throw err;
    }
  };
};

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','member')) DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('todo','doing','done')) DEFAULT 'todo',
  priority TEXT NOT NULL CHECK(priority IN ('alta','media','baixa')) DEFAULT 'media',
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  recurrence_type TEXT NOT NULL DEFAULT 'none',
  recurrence_interval INTEGER NOT NULL DEFAULT 1,
  recurrence_parent_id INTEGER,
  recurrence_end_date TEXT,
  tipo_tarefa TEXT NOT NULL DEFAULT 'outros',
  competencia TEXT,
  requer_arquivo INTEGER NOT NULL DEFAULT 0,
  arquivo_padrao TEXT,
  pasta_relacionada TEXT,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Regimes tributários disponíveis no formulário de empresa (lista suspensa,
-- carregada dinamicamente — o administrador pode adicionar novos).
CREATE TABLE IF NOT EXISTS tax_regimes (
  nome TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Catálogo mestre de obrigações fiscais (nova arquitetura de "tarefas").
-- Cada linha é um tipo de obrigação reconhecido pelo sistema (ex: tipo
-- "federal", campo "DAS"). "Relatórios" foi deliberadamente excluído do
-- CHECK abaixo: essa categoria não tem nenhum dado real na planilha até
-- o momento (ver RELATORIO_REESTRUTURACAO_PLANILHA.md), então não nasce
-- catálogo para ela — pode ser revisitado no futuro se passar a ter uso.
CREATE TABLE IF NOT EXISTS obrigacoes_catalogo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK(tipo IN ('municipal','estadual','federal','anual')),
  campo TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tipo, campo)
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL DEFAULT 'upload',
  source_path TEXT
);

-- Arquivos encontrados na pasta monitorada do servidor (indexação reversa).
-- indexed_files guarda TODO arquivo visto na pasta; quando alguém vincula um
-- deles a uma tarefa, uma linha correspondente é criada em "files" também
-- (source='indexed'), para reaproveitar a listagem/download já existentes.
CREATE TABLE IF NOT EXISTS indexed_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  relative_path TEXT NOT NULL UNIQUE,
  absolute_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER,
  mtime TEXT,
  linked_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Controle de Empresas: espelha a aba "Empresas" da planilha de controle.
-- codigo é o identificador de negócio (não é a PK técnica) para permitir
-- reimportar a planilha periodicamente e atualizar em vez de duplicar.
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo INTEGER UNIQUE,
  cnpj TEXT,
  razao_social TEXT NOT NULL,
  tributacao TEXT,
  inscricao_estadual TEXT,
  estado TEXT,
  inscricao_municipal TEXT,
  municipio TEXT,
  partes_relacionadas TEXT,
  usuario TEXT,
  eventos TEXT,
  envio_documentos TEXT,
  dia_util INTEGER,
  data_limite TEXT,
  data_inicio TEXT,
  data_final TEXT,
  status_code INTEGER,
  acompanhamento TEXT,
  procuracoes TEXT,
  conferencia TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Obrigações fiscais por empresa (Municipais/Estaduais/Federais/Anuais).
-- Guardamos como JSON (rótulo + valor, na ordem original da planilha) em vez
-- de uma coluna por obrigação, porque cada aba tem dezenas de colunas
-- diferentes e a planilha muda com frequência — isso evita ter que alterar
-- o banco toda vez que uma nova obrigação aparece na planilha.
CREATE TABLE IF NOT EXISTS company_obligations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo INTEGER NOT NULL,
  cnpj TEXT,
  tipo TEXT NOT NULL CHECK(tipo IN ('municipal','estadual','federal','anual')),
  data_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(codigo, tipo)
);

-- Parcelamentos (ativos e encerrados). cnpj_normalizado (só dígitos) é usado
-- para casar com a empresa mesmo que a formatação do CNPJ varie um pouco.
CREATE TABLE IF NOT EXISTS company_installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cnpj TEXT,
  cnpj_normalizado TEXT NOT NULL,
  razao_social TEXT,
  tipo TEXT NOT NULL CHECK(tipo IN ('ativo','encerrado')),
  situacao TEXT,
  forma_envio TEXT,
  usuario TEXT,
  flags_json TEXT NOT NULL DEFAULT '[]',
  observacoes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(cnpj_normalizado, tipo)
);

-- Configurações gerais do sistema, guardadas como chave/valor (ex: o
-- modelo padrão de estrutura de pastas, em JSON).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Modelo de pastas PERSONALIZADO por empresa (sobrescreve o modelo padrão
-- guardado em "settings" quando existir). Permite que cada empresa tenha
-- sua própria estrutura, sem obrigar todo mundo a usar o mesmo modelo.
CREATE TABLE IF NOT EXISTS company_folder_templates (
  codigo INTEGER PRIMARY KEY,
  structure_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Compatibilidade: adiciona colunas de recorrência em bancos já existentes
// (necessário porque ALTER TABLE não aceita "IF NOT EXISTS" no SQLite)
const taskCols = db.prepare("PRAGMA table_info(tasks)").all().map((c) => c.name);
if (!taskCols.includes('recurrence_type')) {
  db.exec("ALTER TABLE tasks ADD COLUMN recurrence_type TEXT NOT NULL DEFAULT 'none'");
}
if (!taskCols.includes('recurrence_interval')) {
  db.exec('ALTER TABLE tasks ADD COLUMN recurrence_interval INTEGER NOT NULL DEFAULT 1');
}
if (!taskCols.includes('recurrence_parent_id')) {
  db.exec('ALTER TABLE tasks ADD COLUMN recurrence_parent_id INTEGER');
}
if (!taskCols.includes('recurrence_end_date')) {
  db.exec('ALTER TABLE tasks ADD COLUMN recurrence_end_date TEXT');
}
if (!taskCols.includes('tipo_tarefa')) {
  db.exec("ALTER TABLE tasks ADD COLUMN tipo_tarefa TEXT NOT NULL DEFAULT 'outros'");
}
if (!taskCols.includes('competencia')) {
  db.exec('ALTER TABLE tasks ADD COLUMN competencia TEXT');
}
if (!taskCols.includes('requer_arquivo')) {
  db.exec('ALTER TABLE tasks ADD COLUMN requer_arquivo INTEGER NOT NULL DEFAULT 0');
}
if (!taskCols.includes('arquivo_padrao')) {
  db.exec('ALTER TABLE tasks ADD COLUMN arquivo_padrao TEXT');
}
if (!taskCols.includes('pasta_relacionada')) {
  db.exec('ALTER TABLE tasks ADD COLUMN pasta_relacionada TEXT');
}
if (!taskCols.includes('company_id')) {
  db.exec('ALTER TABLE tasks ADD COLUMN company_id INTEGER');
}

// Tarefas antigas (de antes da competência existir) não devem ficar
// invisíveis quando alguém filtrar por um mês — preenche com o mês atual.
db.prepare("UPDATE tasks SET competencia = strftime('%Y-%m','now') WHERE competencia IS NULL").run();

// Semeia os regimes tributários mais comuns, se a tabela estiver vazia
const regimeCount = db.prepare('SELECT COUNT(*) AS c FROM tax_regimes').get().c;
if (regimeCount === 0) {
  const insertRegime = db.prepare('INSERT OR IGNORE INTO tax_regimes (nome) VALUES (?)');
  ['Simples Nacional', 'MEI', 'Lucro Presumido', 'Lucro Real', 'Lucro Arbitrado', 'Isenta'].forEach((r) => insertRegime.run(r));
}

// Compatibilidade: se o banco já existia de uma versão anterior sem as
// colunas "source"/"source_path" em files, adiciona agora.
const fileCols = db.prepare("PRAGMA table_info(files)").all().map((c) => c.name);
if (!fileCols.includes('source')) {
  db.exec("ALTER TABLE files ADD COLUMN source TEXT NOT NULL DEFAULT 'upload'");
}
if (!fileCols.includes('source_path')) {
  db.exec('ALTER TABLE files ADD COLUMN source_path TEXT');
}

// Garante que exista um modelo padrão de estrutura de pastas (baseado no
// mesmo padrão do script de criação de pastas usado pelo escritório).
const DEFAULT_FOLDER_TEMPLATE = {
  setores: [
    {
      nome: '01_FISCAL',
      mensal_dir: '01_MENSAL',
      anual_dir: '02_ANUAL_PERIODICO',
      mensal: ['01_NOTAS_ENTRADA', '02_NOTAS_SAIDA', '03_SERVICOS_TOMADOS', '04_SERVICOS_PRESTADOS', '05_APURACAO_IMPOSTOS', '06_EFD_ICMS_IPI', '07_EFD_REINF', '08_DCTF_WEB'],
      anual: ['DEFIS', 'DIRF', 'SPED_ECF', 'ALVARAS_LICENCAS'],
    },
    {
      nome: '02_CONTABIL',
      mensal_dir: '01_MENSAL',
      anual_dir: '02_ANUAL',
      mensal: ['01_EXTRATOS_BANCARIOS', '02_COMPROVANTES_DESPESAS', '03_RELATORIOS_FECHAMENTO', '04_CONCILIACAO'],
      anual: ['BALANCO_BALANCETES', 'DRE', 'ECD_SPED_CONTABIL', 'LIVROS_DIARIO_RAZAO'],
    },
  ],
  extras: ['00_CADASTRO_E_CONTRATOS'],
};

const existingTemplate = db.prepare('SELECT key FROM settings WHERE key = ?').get('folder_template');
if (!existingTemplate) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
    'folder_template',
    JSON.stringify(DEFAULT_FOLDER_TEMPLATE)
  );
}

// Garante que exista um administrador inicial (usa .env, ou valores padrão)
const adminEmail = process.env.ADMIN_EMAIL || 'admin@empresa.com';
const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);

if (!existingAdmin) {
  const name = process.env.ADMIN_NAME || 'Administrador';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(name, adminEmail, hash, 'admin');
  console.log(`Usuário administrador criado: ${adminEmail} (defina/altere a senha no .env)`);
}

module.exports = db;
