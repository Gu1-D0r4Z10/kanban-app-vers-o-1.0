// Importa as abas de obrigações fiscais (Municipais/Estaduais/Federais/
// Obrigações Anuais) e de parcelamentos (Parcelamentos/Parcelamentos
// Encerrados) para o banco de dados, formando a "ficha" completa de cada
// empresa junto com o Controle de Empresas.

const XLSX = require('xlsx');
const db = require('../db/init');

function toIntOrNull(value) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

function onlyDigits(value) {
  return value ? String(value).replace(/\D/g, '') : '';
}

function readSheetRows(workbook, sheetName) {
  if (!workbook.SheetNames.includes(sheetName)) return null;
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
}

function cellToText(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return text === '' ? null : text;
}

// Define, para cada aba de obrigação, quais colunas viram a "ficha" (as
// colunas identificadoras como Código/CNPJ/Razão Social/Tributação/Usuário
// ficam de fora, pois já existem no Controle de Empresas).
const OBLIGATION_SHEETS = {
  municipal: {
    sheetName: 'Municipais',
    fields: ['Vencimento TFE', 'Senha Prefeitura', 'Vencto. ISS', 'ISSQN', 'Escrit. Prefeitura', 'DSUP', 'Imunidades SDI', 'Declaração GBF', 'Parc Municipais'],
  },
  estadual: {
    sheetName: 'Estaduais',
    fields: ['GUIA ICMS', 'DIFAL', 'GUIA IPI', 'Bloco K', 'SPED Fiscal', 'DeSTDA', 'Parc Estaduais'],
  },
  federal: {
    sheetName: 'Federais',
    fields: ['Darfs Retidos', 'Darfs CPRB', 'EFD-Reinf 2000', 'EFD-Reinf 4000', 'Aluguel', 'Convênio Médico', 'DIRBI', 'DAS', 'Darfs PisCofins', 'Darfs IrpjCsll', 'EFD Contribuições', 'MIT', 'DCTFWeb', 'Parc Federais', 'Conferência'],
  },
  anual: {
    sheetName: 'Obrigações Anuais',
    fields: ['DMED', 'DIMOB', 'DEFIS', 'DASN-SIMEI', 'DECLAN', 'DAMEF-VAF', 'ECD', 'ECF', 'DITR'],
  },
};

function importObligations(workbookSource) {
  const workbook =
    typeof workbookSource === 'string'
      ? XLSX.readFile(workbookSource, { cellDates: true })
      : XLSX.read(workbookSource, { type: 'buffer', cellDates: true });

  const upsert = db.prepare(`
    INSERT INTO company_obligations (codigo, cnpj, tipo, data_json, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(codigo, tipo) DO NOTHING
  `);

  let imported = 0;
  let already_existing = 0;

  for (const [tipo, config] of Object.entries(OBLIGATION_SHEETS)) {
    const rows = readSheetRows(workbook, config.sheetName);
    if (!rows) continue;

    const importSheet = db.transaction((rows) => {
      for (const row of rows) {
        const codigo = toIntOrNull(row['Código']);
        if (codigo === null) continue;

        const dataJson = JSON.stringify(
          config.fields.map((label) => ({ label, value: cellToText(row[label]) }))
        );

        const result = upsert.run(codigo, cellToText(row['CNPJ']), tipo, dataJson);

        if (result.changes > 0) imported++;
        else already_existing++;
      }
    });
    importSheet(rows);
  }

  return { imported, already_existing };
}

// Colunas de parcelamento que viram "flags" (marcadas com 'X' quando ativas)
const INSTALLMENT_FLAG_FIELDS_ATIVO = [
  'Simples Nacional ', 'RELP SN', 'PERT SN', 'Não Previdenciário', 'Previdenciário',
  'Demais Débitos', 'DCTF-Web', 'PGFN', 'PMSP', 'Dívida Ativa Mun', 'Parcelamento P.P.I', 'Estadual',
];
const INSTALLMENT_FLAG_FIELDS_ENCERRADO = INSTALLMENT_FLAG_FIELDS_ATIVO.filter((f) => f !== 'Demais Débitos');

function importInstallments(workbookSource) {
  const workbook =
    typeof workbookSource === 'string'
      ? XLSX.readFile(workbookSource, { cellDates: true })
      : XLSX.read(workbookSource, { type: 'buffer', cellDates: true });

  const upsert = db.prepare(`
    INSERT INTO company_installments (
      cnpj, cnpj_normalizado, razao_social, tipo, situacao, forma_envio,
      usuario, flags_json, observacoes, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')
    )
    ON CONFLICT(cnpj_normalizado, tipo) DO NOTHING
  `);

  let imported = 0;
  let already_existing = 0;

  const sheetsConfig = [
    { sheetName: 'Parcelamentos', tipo: 'ativo', fields: INSTALLMENT_FLAG_FIELDS_ATIVO },
    { sheetName: 'Parcelamentos Encerrados', tipo: 'encerrado', fields: INSTALLMENT_FLAG_FIELDS_ENCERRADO },
  ];

  for (const { sheetName, tipo, fields } of sheetsConfig) {
    const rows = readSheetRows(workbook, sheetName);
    if (!rows) continue;

    const importSheet = db.transaction((rows) => {
      for (const row of rows) {
        const cnpj = cellToText(row['CNPJ']);
        const cnpjNorm = onlyDigits(cnpj);
        if (!cnpjNorm) continue;

        const flagsJson = JSON.stringify(
          fields
            .map((label) => ({ label: label.trim(), active: cellToText(row[label]) !== null }))
            .filter((f) => f.active)
        );

        const result = upsert.run(
          cnpj,
          cnpjNorm,
          cellToText(row['RAZÃO SOCIAL']),
          tipo,
          cellToText(row['Situação']),
          cellToText(row['Forma de envio']),
          cellToText(row['Usuario '] ?? row['Usuario']),
          flagsJson,
          cellToText(row['OBSERVAÇÕES'])
        );

        if (result.changes > 0) imported++;
        else already_existing++;
      }
    });
    importSheet(rows);
  }

  return { imported, already_existing };
}

module.exports = { importObligations, importInstallments };
