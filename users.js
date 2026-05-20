const express = require('express');
const router  = express.Router();
const User    = require('../models/User');
const { authenticateHTTP } = require('../middleware/auth');

// ── GET /api/users ── list all users except self ─────────────────────────────
router.get('/', authenticateHTTP, async (req, res) => {
  try {
    const users = await User.find(
      { _id: { $ne: req.user.sub } },
      'username email isOnline lastSeen publicKey createdAt'
    );
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/users/:id/publickey ─────────────────────────────────────────────
router.get('/:id/publickey', authenticateHTTP, async (req, res) => {
  try {
    const user = await User.findById(req.params.id, 'username publicKey');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (!user.publicKey) return res.status(404).json({ error: 'User has no public key registered.' });
    res.json({ username: user.username, publicKey: user.publicKey });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
