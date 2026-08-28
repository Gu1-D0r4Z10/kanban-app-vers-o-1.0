// Sincronia em tempo real: mantém uma lista de navegadores conectados e
// envia eventos (tarefa criada/movida, arquivo anexado, arquivo indexado
// encontrado na pasta do servidor, etc.) assim que eles acontecem, para que
// todas as telas abertas se atualizem sozinhas, sem precisar dar F5.

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

let wss = null;

function attach(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (socket, req) => {
    // Autentica a conexão pelo token enviado na URL (?token=...)
    try {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      const payload = jwt.verify(token, JWT_SECRET);
      socket.user = payload;
    } catch (err) {
      socket.close(4001, 'Não autenticado');
      return;
    }

    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
  });

  // Descarta conexões mortas periodicamente (ex: aba fechada sem aviso)
  setInterval(() => {
    wss.clients.forEach((socket) => {
      if (!socket.isAlive) return socket.terminate();
      socket.isAlive = false;
      socket.ping();
    });
  }, 30000);

  console.log('WebSocket de sincronia em tempo real ativo em /ws');
}

// Envia um evento para todos os navegadores conectados
function broadcast(type, payload = {}) {
  if (!wss) return;
  const message = JSON.stringify({ type, payload, ts: Date.now() });
  wss.clients.forEach((socket) => {
    if (socket.readyState === 1) socket.send(message);
  });
}

module.exports = { attach, broadcast };
