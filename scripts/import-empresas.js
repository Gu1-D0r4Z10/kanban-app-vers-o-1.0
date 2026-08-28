// Importa a aba "Empresas" de uma planilha Excel (.xlsx) para o Controle de
// Empresas do sistema. Pode ser rodado quantas vezes precisar — cada
// empresa é identificada pelo "Código", então rodar de novo com uma
// planilha atualizada ATUALIZA os registros existentes em vez de duplicar.
//
// Uso:
//   npm run import-empresas -- "caminho/para/planilha.xlsx"
//
// Se nenhum caminho for informado, tenta usar "planilha.xlsx" na raiz do projeto.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { importAllSheets } = require('../lib/import-empresas');

const filePath = process.argv[2] || process.env.EMPRESAS_XLSX_PATH || path.join(__dirname, '..', 'planilha.xlsx');

console.log(`Lendo planilha: ${filePath}`);

try {
  const result = importAllSheets(filePath);
  console.log(`\nImportação concluída.`);
  console.log(`  Empresas importadas/atualizadas: ${result.imported}`);
  console.log(`  Linhas de empresas ignoradas: ${result.skipped}`);
  console.log(`  Obrigações fiscais importadas: ${result.obligations_imported}`);
  console.log(`  Parcelamentos importados: ${result.installments_imported}`);
} catch (err) {
  console.error(`\n[ERRO] Falha ao importar: ${err.message}`);
  process.exit(1);
}
