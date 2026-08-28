require('dotenv').config();

// Captura qualquer erro inesperado que aconteça durante a inicialização e
// mostra uma mensagem clara em vez de um erro técnico difícil de entender.
process.on('uncaughtException', (err) => {
  console.error('\n========================================');
  console.error('ERRO INESPERADO — o servidor não conseguiu iniciar.');
  console.error('========================================');
  console.error(err.stack || err.message || err);
  console.error('\nSe o erro acima mencionar "Cannot find module", rode "npm install" de novo.');
  console.error('Se persistir, copie esta mensagem inteira e peça ajuda.\n');
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('\nERRO INESPERADO (promessa não tratada):', err);
  process.exit(1);
});

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');

require('./db/init'); // garante que o banco e o admin inicial existam

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const taskRoutes = require('./routes/tasks');
const fileRoutes = require('./routes/files');
const indexedFileRoutes = require('./routes/indexed-files');
const companyRoutes = require('./routes/companies');
const directoryRoutes = require('./routes/directories');
const taxRegimeRoutes = require('./routes/tax-regimes');

const realtime = require('./realtime/ws');
const watcher = require('./realtime/watcher');
const { importAllSheets, countCompanies } = require('./lib/import-empresas');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// API
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/tasks', fileRoutes); // rotas /api/tasks/:taskId/files...
app.use('/api/indexed-files', indexedFileRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/directories', directoryRoutes);
app.use('/api/tax-regimes', taxRegimeRoutes);

// Front-end estático (HTML/CSS/JS puro)
app.use(express.static(path.join(__dirname, 'public')));

// Qualquer outra rota GET cai no index.html (SPA simples)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Usamos http.createServer manualmente (em vez de app.listen) para poder
// anexar o WebSocket de sincronia em tempo real ao mesmo servidor/porta.
const server = http.createServer(app);
realtime.attach(server);

// Trata erros comuns ao tentar abrir a porta com uma mensagem clara,
// em vez de deixar o processo travar num erro técnico difícil de entender.
server.on('error', (err) => {
  console.error('\n========================================');
  if (err.code === 'EADDRINUSE') {
    console.error(`ERRO: a porta ${PORT} já está sendo usada por outro programa.`);
    console.error('========================================');
    console.error('\nIsso costuma acontecer quando uma instância anterior deste');
    console.error('servidor ainda está rodando em segundo plano (por exemplo, se a');
    console.error('janela foi fechada sem parar o processo com Ctrl+C).');
    console.error('\nComo resolver:');
    console.error('  1. Feche todas as janelas que possam estar rodando este sistema');
    console.error('  2. No Windows, abra o Gerenciador de Tarefas, procure por');
    console.error('     "Node.js JavaScript Runtime" e finalize o processo');
    console.error(`  3. Ou troque a porta: edite o arquivo .env e mude PORT=${PORT}`);
    console.error('     para outro número (ex: PORT=3001) e rode de novo\n');
  } else if (err.code === 'EACCES') {
    console.error(`ERRO: sem permissão para usar a porta ${PORT}.`);
    console.error('========================================');
    console.error(`\nTente trocar a porta no arquivo .env para um número acima de`);
    console.error('1024 (ex: PORT=3001) e rode de novo.\n');
  } else {
    console.error('ERRO ao iniciar o servidor:');
    console.error('========================================');
    console.error(err.stack || err.message || err);
    console.error('');
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nPainel de Tarefas rodando!`);
  console.log(`Acesse localmente em: http://localhost:${PORT}`);
  console.log(`Acesse pela rede em:  http://<IP-DO-SERVIDOR>:${PORT}  (ex: http://192.168.0.10:${PORT})\n`);

  // Inicia o monitoramento da pasta indexada (indexação reversa)
  const watchedFolder = process.env.WATCHED_FOLDER || './watched-files';
  watcher.start(watchedFolder);

  // Importação automática: se o Controle de Empresas ainda estiver vazio e
  // existir uma planilha "planilha.xlsx" na raiz do projeto (ou o caminho
  // definido em EMPRESAS_XLSX_PATH), importa sozinho na primeira vez que o
  // servidor sobe — assim ninguém depende de lembrar de rodar um comando.
  try {
    if (countCompanies() === 0) {
      const fs = require('fs');
      const defaultXlsx = process.env.EMPRESAS_XLSX_PATH || path.join(__dirname, 'planilha.xlsx');
      if (fs.existsSync(defaultXlsx)) {
        console.log(`Controle de Empresas vazio. Importando automaticamente de: ${defaultXlsx}`);
        const result = importAllSheets(defaultXlsx);
        console.log(`Importação automática concluída: ${result.imported} empresas, ${result.obligations_imported} obrigações, ${result.installments_imported} parcelamentos.\n`);
      }
    }
  } catch (err) {
    console.error('Não foi possível importar a planilha automaticamente:', err.message);
    console.error('Você pode importar manualmente depois com: npm run import-empresas\n');
  }
});
