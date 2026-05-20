const User    = require('../models/User');
const Message = require('../models/Message');
const { authenticateSocket }               = require('../middleware/auth');
const { verifyMessageHash, verifySignature, getDMRoomId } = require('../services/crypto');

/**
 * Attach Socket.IO handlers to the server.
 * @param {import('socket.io').Server} io
 */
const initSocket = (io) => {
  // ── Auth middleware ────────────────────────────────────────────────────────
  io.use(authenticateSocket);

  // ── Track connected sockets by userId ─────────────────────────────────────
  const onlineUsers = new Map(); // userId → Set<socketId>

  io.on('connection', async (socket) => {
    const userId   = socket.user.sub;
    const username = socket.user.username;

    console.log(`[Socket] Connected: ${username} (${socket.id})`);

    // Track socket
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);

    // Join personal room (to receive targeted events)
    socket.join(`user:${userId}`);

    // Mark online
    await User.findByIdAndUpdate(userId, { isOnline: true });
    io.emit('user:status', { userId, isOnline: true });
    io.emit('user:joined', { userId, username, isOnline: true });
    io.emit('user:joined', { userId, username, isOnline: true });

    // ── EVENT: message:send ────────────────────────────────────────────────
    socket.on('message:send', async (payload, ack) => {
      try {
        const { recipientId, ciphertext, iv, tag, encryptedKey, signature, hash } = payload;

        // 1. Validate required fields
        if (!recipientId || !ciphertext || !iv || !tag || !encryptedKey || !signature || !hash) {
          return ack?.({ error: 'Missing required payload fields.' });
        }

        // 2. Server-side hash verification (integrity check)
        const hashValid = verifyMessageHash(ciphertext, iv, tag, hash);
        if (!hashValid) {
          console.warn(`[Security] Hash mismatch from ${username}`);
          return ack?.({ error: 'Message integrity check failed.' });
        }

        // 3. Fetch sender's stored public key and verify signature
        const sender = await User.findById(userId, 'publicKey username');
        if (!sender?.publicKey) {
          return ack?.({ error: 'Sender has no registered public key. Upload it first.' });
        }

        const sigValid = verifySignature(ciphertext, iv, tag, signature, sender.publicKey);
        if (!sigValid) {
          console.warn(`[Security] Invalid signature from ${username}`);
          return ack?.({ error: 'Digital signature verification failed.' });
        }

        // 4. Recipient must exist
        const recipient = await User.findById(recipientId, '_id username');
        if (!recipient) {
          return ack?.({ error: 'Recipient not found.' });
        }

        // 5. Build room ID
        const roomId = getDMRoomId(userId, recipientId);

        // 6. Persist encrypted message (server never sees plaintext)
        const message = await Message.create({
          roomId,
          sender:       userId,
          recipient:    recipientId,
          ciphertext,
          iv,
          tag,
          encryptedKey,
          signature,
          hash,
        });

        // 7. Build broadcast payload
        const broadcastPayload = {
          messageId:    message._id,
          roomId,
          senderId:     userId,
          senderName:   username,
          recipientId,
          ciphertext,
          iv,
          tag,
          encryptedKey,
          signature,
          hash,
          createdAt:    message.createdAt,
        };

        // 8. Deliver to recipient (all their connected sockets) and sender
        io.to(`user:${recipientId}`).emit('message:receive', broadcastPayload);
        socket.emit('message:sent', broadcastPayload); // echo to sender's other tabs

        // 9. Mark delivered if recipient is online
        if (onlineUsers.has(recipientId.toString())) {
          await Message.findByIdAndUpdate(message._id, { delivered: true });
          socket.emit('message:delivered', { messageId: message._id });
        }

        ack?.({ success: true, messageId: message._id });
      } catch (err) {
        console.error('[Socket] message:send error:', err);
        ack?.({ error: 'Server error processing message.' });
      }
    });

    // ── EVENT: message:read ────────────────────────────────────────────────
    socket.on('message:read', async ({ messageId }) => {
      try {
        const msg = await Message.findByIdAndUpdate(
          messageId,
          { read: true },
          { new: true }
        );
        if (msg) {
          io.to(`user:${msg.sender}`).emit('message:read_receipt', { messageId });
        }
      } catch (err) {
        console.error('[Socket] message:read error:', err);
      }
    });

    // ── EVENT: typing ──────────────────────────────────────────────────────
    socket.on('typing:start', ({ recipientId }) => {
      socket.to(`user:${recipientId}`).emit('typing:start', { userId, username });
    });

    socket.on('typing:stop', ({ recipientId }) => {
      socket.to(`user:${recipientId}`).emit('typing:stop', { userId });
    });

    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      console.log(`[Socket] Disconnected: ${username} (${socket.id})`);

      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen: new Date() });
          io.emit('user:status', { userId, isOnline: false });
        }
      }
    });
  });
};

module.exports = initSocket;
