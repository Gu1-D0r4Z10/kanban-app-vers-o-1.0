// Lógica de importação da aba "Empresas" da planilha para o banco de dados.
// Compartilhada entre o script de terminal (scripts/import-empresas.js) e a
// rota de upload pelo navegador (POST /api/companies/import).

const XLSX = require('xlsx');
const db = require('../db/init');

const SHEET_NAME = 'Empresas';

function excelDateToText(value) {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (value === null || value === undefined) return null;
  return String(value).trim();
}

function toIntOrNull(value) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

function normalizeStatusCode(value) {
  const n = toIntOrNull(value);
  return [-1, 0, 1].includes(n) ? n : null;
}

// workbookSource: caminho de arquivo (string) OU Buffer com o conteúdo do .xlsx
function importEmpresas(workbookSource) {
  const workbook =
    typeof workbookSource === 'string'
      ? XLSX.readFile(workbookSource, { cellDates: true })
      : XLSX.read(workbookSource, { type: 'buffer', cellDates: true });

  if (!workbook.SheetNames.includes(SHEET_NAME)) {
    const err = new Error(
      `A aba "${SHEET_NAME}" não foi encontrada nesta planilha. Abas disponíveis: ${workbook.SheetNames.join(', ')}`
    );
    err.code = 'SHEET_NOT_FOUND';
    throw err;
  }

  const sheet = workbook.Sheets[SHEET_NAME];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });

  const upsert = db.prepare(`
    INSERT INTO companies (
      codigo, cnpj, razao_social, tributacao, inscricao_estadual, estado,
      inscricao_municipal, municipio, partes_relacionadas, usuario, eventos,
      envio_documentos, dia_util, data_limite, data_inicio, data_final,
      status_code, acompanhamento, procuracoes, conferencia, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')
    )
    ON CONFLICT(codigo) DO NOTHING
  `);

  let imported = 0;
  let already_existing = 0;
  let skipped = 0;

  const importAll = db.transaction((rows) => {
    for (const row of rows) {
      const razaoSocial = row['Razão Social'];
      const codigo = toIntOrNull(row['Código']);

      if (!razaoSocial || codigo === null) {
        skipped++;
        continue;
      }

      const result = upsert.run(
        codigo,
        row['CNPJ'] != null ? String(row['CNPJ']).trim() : null,
        String(razaoSocial).trim(),
        row['Tributação'] != null ? String(row['Tributação']).trim() : null,
        row['Inscrição Estadual'] != null ? String(row['Inscrição Estadual']).trim() : null,
        row['Estado'] != null ? String(row['Estado']).trim() : null,
        row['Inscrição Municipal'] != null ? String(row['Inscrição Municipal']).trim() : null,
        row['Município'] != null ? String(row['Município']).trim() : null,
        row['Partes Relacionadas'] != null ? String(row['Partes Relacionadas']).trim() : null,
        row['Usuário'] != null ? String(row['Usuário']).trim() : null,
        row['Eventos'] != null ? String(row['Eventos']).trim() : null,
        row['Envio de Documentos'] != null ? String(row['Envio de Documentos']).trim() : null,
        toIntOrNull(row['Dia Útil']),
        excelDateToText(row['Data Limite']),
        excelDateToText(row['Data Início']),
        excelDateToText(row['Data Final']),
        normalizeStatusCode(row['Status']),
        row['Acompanhamento'] != null ? String(row['Acompanhamento']).trim() : null,
        row['Procurações'] != null ? String(row['Procurações']).trim() : null,
        row['Conferência'] != null ? String(row['Conferência']).trim() : null
      );

      if (result.changes > 0) imported++;
      else already_existing++;
    }
  });

  importAll(rows);
  return { imported, already_existing, skipped };
}

function countCompanies() {
  return db.prepare('SELECT COUNT(*) AS c FROM companies').get().c;
}

// Importa a planilha inteira de uma vez: Empresas + obrigações fiscais
// (Municipais/Estaduais/Federais/Anuais) + Parcelamentos (ativos e
// encerrados). Usado tanto pelo botão de upload quanto pelo script de
// terminal e pela importação automática ao iniciar o servidor.
function importAllSheets(workbookSource) {
  const { importObligations, importInstallments } = require('./import-obrigacoes');

  const empresas = importEmpresas(workbookSource);
  const obrigacoes = importObligations(workbookSource);
  const parcelamentos = importInstallments(workbookSource);

  return {
    imported: empresas.imported,
    already_existing: empresas.already_existing,
    skipped: empresas.skipped,
    obligations_imported: obrigacoes.imported,
    obligations_existing: obrigacoes.already_existing,
    installments_imported: parcelamentos.imported,
    installments_existing: parcelamentos.already_existing,
  };
}

module.exports = { importEmpresas, countCompanies, importAllSheets };
