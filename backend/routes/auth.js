const express = require('express');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const router  = express.Router();

const User               = require('../models/User');
const { authenticateHTTP } = require('../middleware/auth');
const { getPrivateKey, getPublicKey } = require('../config/keys');

const signToken = (payload, expiresIn) =>
  jwt.sign(payload, getPrivateKey(), { algorithm: 'RS256', expiresIn });

// ── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email, and password are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing) {
      return res.status(409).json({ error: 'Username or email already taken.' });
    }

    const user = new User({ username, email, passwordHash: password });
    await user.save();

    const accessToken  = signToken({ sub: user._id, username: user.username }, process.env.JWT_EXPIRY || '24h');
    const refreshToken = signToken({ sub: user._id, type: 'refresh' }, process.env.JWT_REFRESH_EXPIRY || '7d');

    // Store hashed refresh token
    user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await user.save();

    res.status(201).json({
      message: 'Account created.',
      accessToken,
      refreshToken,
      user: user.toSafeObject(),
    });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required.' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const accessToken  = signToken({ sub: user._id, username: user.username }, process.env.JWT_EXPIRY || '24h');
    const refreshToken = signToken({ sub: user._id, type: 'refresh' }, process.env.JWT_REFRESH_EXPIRY || '7d');

    user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    user.isOnline = true;
    await user.save();

    res.json({
      message: 'Login successful.',
      accessToken,
      refreshToken,
      user: user.toSafeObject(),
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required.' });

    let payload;
    try {
      payload = jwt.verify(refreshToken, getPublicKey(), { algorithms: ['RS256'] });
    } catch {
      return res.status(401).json({ error: 'Invalid or expired refresh token.' });
    }

    if (payload.type !== 'refresh') {
      return res.status(401).json({ error: 'Not a refresh token.' });
    }

    const user = await User.findById(payload.sub);
    if (!user || !user.refreshTokenHash) {
      return res.status(401).json({ error: 'Session not found.' });
    }

    const match = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!match) return res.status(401).json({ error: 'Refresh token revoked.' });

    const newAccessToken  = signToken({ sub: user._id, username: user.username }, process.env.JWT_EXPIRY || '24h');
    const newRefreshToken = signToken({ sub: user._id, type: 'refresh' }, process.env.JWT_REFRESH_EXPIRY || '7d');

    user.refreshTokenHash = await bcrypt.hash(newRefreshToken, 10);
    await user.save();

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    console.error('[Auth] Refresh error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', authenticateHTTP, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.sub, {
      refreshTokenHash: null,
      isOnline: false,
      lastSeen: new Date(),
    });
    res.json({ message: 'Logged out.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticateHTTP, async (req, res) => {
  try {
    const user = await User.findById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── PUT /api/auth/keys ── Upload RSA public key after client generates it ────
router.put('/keys', authenticateHTTP, async (req, res) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey || !publicKey.includes('BEGIN PUBLIC KEY')) {
      return res.status(400).json({ error: 'Valid RSA public key (PEM) required.' });
    }
    await User.findByIdAndUpdate(req.user.sub, { publicKey });
    res.json({ message: 'Public key updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
