const express = require('express');
const router  = express.Router();
const Message = require('../models/Message');
const { authenticateHTTP } = require('../middleware/auth');
const { getDMRoomId }      = require('../services/crypto');


router.get('/:userId', authenticateHTTP, async (req, res) => {
  try {
    const roomId = getDMRoomId(req.user.sub, req.params.userId);
    const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
    const skip   = parseInt(req.query.skip) || 0;

    const messages = await Message.find({ roomId })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .populate('sender',    'username')
      .populate('recipient', 'username');

    res.json({ roomId, messages, count: messages.length });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
