const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'chave-insegura-troque-isso';

// Exige que o usuário esteja autenticado (token válido no cabeçalho Authorization)
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  // Aceita o token tanto no cabeçalho Authorization quanto via ?token= na URL
  // (necessário para links de download abertos diretamente pelo navegador)
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || null);

  if (!token) {
    return res.status(401).json({ error: 'Não autenticado. Faça login novamente.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, name, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
  }
}

// Exige que o usuário autenticado tenha um dos papéis (roles) informados
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Você não tem permissão para esta ação.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, JWT_SECRET };
