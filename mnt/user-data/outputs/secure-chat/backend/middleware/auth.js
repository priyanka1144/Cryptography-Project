const jwt = require('jsonwebtoken');
const { getPublicKey } = require('../config/keys');


const authenticateHTTP = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, getPublicKey(), { algorithms: ['RS256'] });
    req.user = payload;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired.' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }
};


const authenticateSocket = (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Authentication token required.'));
  }

  try {
    const payload = jwt.verify(token, getPublicKey(), { algorithms: ['RS256'] });
    socket.user = payload;
    next();
  } catch (err) {
    next(new Error('Invalid or expired token.'));
  }
};

module.exports = { authenticateHTTP, authenticateSocket };
