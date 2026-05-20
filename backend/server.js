require('dotenv').config();

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const cors     = require('cors');
const path     = require('path');

const connectDB              = require('./config/db');
const { loadOrGenerateKeys } = require('./config/keys');
const authRoutes             = require('./routes/auth');
const userRoutes             = require('./routes/users');
const messageRoutes          = require('./routes/messages');
const initSocket             = require('./socket');

// ── Bootstrap ────────────────────────────────────────────────────────────────
(async () => {
  // Load/generate RSA key pair for JWT
  loadOrGenerateKeys();

  // Connect to MongoDB
  await connectDB();

  const app    = express();
  const server = http.createServer(app);
  const io     = new Server(server, {
    cors: {
      origin:      process.env.CORS_ORIGIN || '*',
      methods:     ['GET', 'POST'],
      credentials: true,
    },
  });

  // ── Middleware ──────────────────────────────────────────────────────────
  app.use(cors({
    origin:      process.env.CORS_ORIGIN || '*',
    credentials: true,
  }));
  app.use(express.json({ limit: '1mb' }));

  // Serve the frontend from /frontend (sibling directory)
  app.use(express.static(path.join(__dirname, '..', 'frontend')));

  // ── API Routes ──────────────────────────────────────────────────────────
  app.use('/api/auth',     authRoutes);
  app.use('/api/users',    userRoutes);
  app.use('/api/messages', messageRoutes);

  // Health check
  app.get('/api/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }));

  // Fallback → serve index.html
  app.get('*', (_, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
  });

  // ── Socket.IO ───────────────────────────────────────────────────────────
  initSocket(io);

  // ── Start ───────────────────────────────────────────────────────────────
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`\n🔐 SecureChat server running on http://localhost:${PORT}`);
    console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
    console.log(`   MongoDB     : ${process.env.MONGO_URI}`);
    console.log(`   CORS origin : ${process.env.CORS_ORIGIN || '*'}\n`);
  });
})();
