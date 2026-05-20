const jwt = require('jsonwebtoken');
const { getPublicKey } = require('../config/keys');

const authenticateHTTP = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, getPublicKey(), { algorithms: ['RS256'] });
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

const authenticateSocket = (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required.'));

  try {
    socket.user = jwt.verify(token, getPublicKey(), { algorithms: ['RS256'] });
    next();
  } catch {
    next(new Error('Invalid or expired token.'));
  }
};

module.exports = { authenticateHTTP, authenticateSocket };