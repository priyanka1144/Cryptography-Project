const User    = require('../models/User');
const Message = require('../models/Message');
const { authenticateSocket }               = require('../middleware/auth');
const { verifyMessageHash, verifySignature, getDMRoomId } = require('../services/crypto');

/**
 * Attach Socket.IO handlers to the server.
 * @param {import('socket.io').Server} io
 */
const initSocket = (io) => {
  
  io.use(authenticateSocket);

 
  const onlineUsers = new Map(); // userId → Set<socketId>

  io.on('connection', async (socket) => {
    const userId   = socket.user.sub;
    const username = socket.user.username;

    console.log(`[Socket] Connected: ${username} (${socket.id})`);

   
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);

   
    socket.join(`user:${userId}`);

    
    await User.findByIdAndUpdate(userId, { isOnline: true });
    io.emit('user:status', { userId, isOnline: true });

   
    socket.on('message:send', async (payload, ack) => {
      try {
        const { recipientId, ciphertext, iv, tag, encryptedKey, signature, hash } = payload;

        
        if (!recipientId || !ciphertext || !iv || !tag || !encryptedKey || !signature || !hash) {
          return ack?.({ error: 'Missing required payload fields.' });
        }

        
        const hashValid = verifyMessageHash(ciphertext, iv, tag, hash);
        if (!hashValid) {
          console.warn(`[Security] Hash mismatch from ${username}`);
          return ack?.({ error: 'Message integrity check failed.' });
        }

        
        const sender = await User.findById(userId, 'publicKey username');
        if (!sender?.publicKey) {
          return ack?.({ error: 'Sender has no registered public key. Upload it first.' });
        }

        const sigValid = verifySignature(ciphertext, iv, tag, signature, sender.publicKey);
        if (!sigValid) {
          console.warn(`[Security] Invalid signature from ${username}`);
          return ack?.({ error: 'Digital signature verification failed.' });
        }

       
        const recipient = await User.findById(recipientId, '_id username');
        if (!recipient) {
          return ack?.({ error: 'Recipient not found.' });
        }

        
        const roomId = getDMRoomId(userId, recipientId);

        
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

        
        io.to(`user:${recipientId}`).emit('message:receive', broadcastPayload);
        //socket.emit('message:sent', broadcastPayload); // echo to sender's other tabs

        
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

    
    socket.on('typing:start', ({ recipientId }) => {
      socket.to(`user:${recipientId}`).emit('typing:start', { userId, username });
    });

    socket.on('typing:stop', ({ recipientId }) => {
      socket.to(`user:${recipientId}`).emit('typing:stop', { userId });
    });

    
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
