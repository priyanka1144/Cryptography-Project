/**
 * app.js — Main application controller.
 * Wires together: Auth, Socket.IO, Crypto, and UI.
 */

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  currentUser:    null,
  userKeys:       null,
  activeChat:     null,
  socket:         null,
  users:          [],
  publicKeyCache: {},
  typingTimer:    null,
};

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const stored = localStorage.getItem('currentUser');
  const token  = localStorage.getItem('accessToken');
  if (stored && token) {
    state.currentUser = JSON.parse(stored);
    await bootApp();
  } else {
    showView('auth-view');
  }
});

// ── Auth flow ─────────────────────────────────────────────────────────────────
document.getElementById('tab-login').addEventListener('click', () => switchAuthTab('login'));
document.getElementById('tab-register').addEventListener('click', () => switchAuthTab('register'));

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  setAuthError('');
  setAuthLoading(true);
  const data = await API.login(username, password);
  setAuthLoading(false);
  if (data.error) return setAuthError(data.error);
  state.currentUser = data.user;
  await bootApp();
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  setAuthError('');
  setAuthLoading(true);
  const data = await API.register(username, email, password);
  setAuthLoading(false);
  if (data.error) return setAuthError(data.error);
  API.setTokens(data.accessToken, data.refreshToken);
  localStorage.setItem('currentUser', JSON.stringify(data.user));
  state.currentUser = data.user;
  await bootApp();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  if (state.socket) state.socket.disconnect();
  await API.logout();
  API.clearTokens();
  state.currentUser = null;
  state.userKeys    = null;
  state.activeChat  = null;
  showView('auth-view');
});

// ── App boot ──────────────────────────────────────────────────────────────────
async function bootApp() {
  showView('app-view');
  document.getElementById('self-username').textContent = state.currentUser.username;

  setStatusBar('Initialising encryption keys…');
  state.userKeys = await SecureCrypto.getOrCreateKeyPair();

  const pem = await SecureCrypto.exportPublicKeyPem(state.userKeys.publicKeyBuf);
  await API.uploadPublicKey(pem);

  connectSocket();

  await new Promise(r => setTimeout(r, 500));
  await refreshUsers();
  setStatusBar('');
}

// ── Socket.IO ─────────────────────────────────────────────────────────────────
function connectSocket() {
  const token = localStorage.getItem('accessToken');
  state.socket = io({ auth: { token } });

  state.socket.on('connect', () => {
    console.log('[Socket] Connected:', state.socket.id);
    setStatusBar('');
  });

  state.socket.on('connect_error', (err) => {
    setStatusBar(`Connection error: ${err.message}`, 'error');
  });

  state.socket.on('disconnect', () => {
    setStatusBar('Disconnected — reconnecting…', 'warn');
  });

  state.socket.on('message:receive', async (payload) => {
    await handleIncomingMessage(payload);
  });

  state.socket.on('message:delivered', ({ messageId }) => {
    const ticks = document.querySelectorAll('.tick');
    if (ticks.length) ticks[ticks.length - 1].textContent = '✓✓';
  });

  state.socket.on('message:read_receipt', () => {
    const ticks = document.querySelectorAll('.tick');
    if (ticks.length) ticks[ticks.length - 1].classList.add('read');
  });

  state.socket.on('typing:start', ({ userId, username }) => {
    if (state.activeChat?.userId === userId) showTyping(username);
  });

  state.socket.on('typing:stop', ({ userId }) => {
    if (state.activeChat?.userId === userId) hideTyping();
  });

  state.socket.on('user:status', ({ userId, isOnline }) => {
    updateUserStatus(userId, isOnline);
    if (state.activeChat?.userId === userId) {
      document.getElementById('chat-header-status').textContent = isOnline ? 'Online' : 'Offline';
    }
  });

  // নতুন user join করলে automatically sidebar update হবে
  state.socket.on('user:joined', async () => {
    await refreshUsers();
  });
}

// ── Users panel ───────────────────────────────────────────────────────────────
async function refreshUsers() {
  const data = await API.getUsers();
  if (data.error) return;
  state.users = data.users;
  renderUserList(data.users);
}

function renderUserList(users) {
  const ul = document.getElementById('user-list');
  ul.innerHTML = '';
  users.forEach((u) => {
    if (u._id === state.currentUser._id) return;
    const li = document.createElement('li');
    li.className = 'user-item' + (u._id === state.activeChat?.userId ? ' active' : '');
    li.dataset.id = u._id;
    li.innerHTML = `
      <img class="avatar" src="https://ui-avatars.com/api/?name=${encodeURIComponent(u.username)}&background=random&color=fff&size=128&rounded=true&bold=true" alt="${u.username}" />
      <div class="user-meta">
        <span class="user-name">${escHtml(u.username)}</span>
        <span class="user-status ${u.isOnline ? 'online' : 'offline'}">${u.isOnline ? 'Online' : 'Offline'}</span>
      </div>
    `;
    li.addEventListener('click', () => openChat(u));
    ul.appendChild(li);
  });
}

function updateUserStatus(userId, isOnline) {
  const li = document.querySelector(`.user-item[data-id="${userId}"]`);
  if (!li) return;
  const span = li.querySelector('.user-status');
  span.textContent = isOnline ? 'Online' : 'Offline';
  span.className   = 'user-status ' + (isOnline ? 'online' : 'offline');
}

// ── Chat ──────────────────────────────────────────────────────────────────────
async function openChat(user) {
  document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.user-item[data-id="${user._id}"]`)?.classList.add('active');

  state.activeChat = { userId: user._id, username: user.username, publicKey: user.publicKey };

  document.getElementById('chat-avatar').src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=random&color=fff&size=128&rounded=true&bold=true`;
  document.getElementById('chat-header-name').textContent = user.username;
  document.getElementById('chat-header-status').textContent = user.isOnline ? 'Online' : 'Offline';
  document.getElementById('chat-placeholder').style.display = 'none';
  document.getElementById('chat-area').style.display        = 'flex';

  const messages = document.getElementById('messages');
  messages.innerHTML = '';

  const history = await API.getMessages(user._id, 50);
  if (history.messages?.length) {
    setStatusBar('Decrypting message history…');
    for (const msg of history.messages) {
      const isSelf = msg.sender._id === state.currentUser._id || msg.sender === state.currentUser._id;
      if (isSelf) {
        appendMessageBubble({ text: '[Encrypted — only recipient can decrypt]', side: 'self', ts: msg.createdAt, verified: null, muted: true });
      } else {
        try {
          const senderPubKey = await getCachedPublicKey(msg.sender._id || msg.sender);
          const plain = await SecureCrypto.decryptMessage(msg, state.userKeys, senderPubKey);
          appendMessageBubble({ text: plain, side: 'other', ts: msg.createdAt, verified: true });
        } catch (err) {
          appendMessageBubble({ text: `[Decryption failed: ${err.message}]`, side: 'other', ts: msg.createdAt, verified: false });
        }
      }
    }
    setStatusBar('');
  }

  messages.scrollTop = messages.scrollHeight;
  document.getElementById('msg-input').focus();
}

async function handleIncomingMessage(payload) {
  if (state.activeChat?.userId !== payload.senderId) {
    showNotification(payload.senderName, '🔐 New encrypted message');
    markUserUnread(payload.senderId);
    return;
  }

  try {
    const senderPubKey = await getCachedPublicKey(payload.senderId);
    const plain = await SecureCrypto.decryptMessage(payload, state.userKeys, senderPubKey);
    hideTyping();
    appendMessageBubble({ text: plain, side: 'other', ts: payload.createdAt, verified: true });
    state.socket.emit('message:read', { messageId: payload.messageId });
  } catch (err) {
    appendMessageBubble({ text: `[Error: ${err.message}]`, side: 'other', ts: payload.createdAt, verified: false });
  }
}

// ── Send message ──────────────────────────────────────────────────────────────
document.getElementById('msg-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('msg-input');
  const text  = input.value.trim();
  if (!text || !state.activeChat) return;
  input.value = '';

  const { userId } = state.activeChat;

  let recipientPubKey;
  try {
    recipientPubKey = await getCachedPublicKey(userId);
  } catch {
    setStatusBar('Could not fetch recipient public key.', 'error');
    return;
  }

  let payload;
  try {
    payload = await SecureCrypto.encryptMessage(text, recipientPubKey, state.userKeys);
  } catch (err) {
    setStatusBar('Encryption failed: ' + err.message, 'error');
    return;
  }

  appendMessageBubble({ text, side: 'self', ts: new Date().toISOString(), verified: true, pending: true });

  state.socket.emit('message:send', { recipientId: userId, ...payload }, (ack) => {
    if (ack?.error) setStatusBar('Send failed: ' + ack.error, 'error');
  });

  stopTypingSignal();
});

// ── Typing indicators ─────────────────────────────────────────────────────────
document.getElementById('msg-input').addEventListener('input', () => {
  if (!state.activeChat) return;
  state.socket.emit('typing:start', { recipientId: state.activeChat.userId });
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(stopTypingSignal, 2000);
});

function stopTypingSignal() {
  if (state.activeChat && state.socket) {
    state.socket.emit('typing:stop', { recipientId: state.activeChat.userId });
  }
}

function showTyping(name) {
  const el = document.getElementById('typing-indicator');
  el.textContent = `${name} is typing…`;
  el.style.display = 'block';
}
function hideTyping() {
  document.getElementById('typing-indicator').style.display = 'none';
}

// ── Public key cache ──────────────────────────────────────────────────────────
async function getCachedPublicKey(userId) {
  if (state.publicKeyCache[userId]) return state.publicKeyCache[userId];
  const data = await API.getUserPublicKey(userId);
  if (!data.publicKey) throw new Error('User has no public key registered.');
  state.publicKeyCache[userId] = data.publicKey;
  return data.publicKey;
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function appendMessageBubble({ text, side, ts, verified, muted, pending }) {
  const messages = document.getElementById('messages');
  const div      = document.createElement('div');
  div.className  = `bubble ${side}${muted ? ' muted' : ''}${pending ? ' pending' : ''}`;

  const time = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let badge = '';
  if (verified === true)  badge = '<span class="verify-badge ok" title="Signature verified ✓">🔐</span>';
  if (verified === false) badge = '<span class="verify-badge fail" title="Verification failed!">⚠️</span>';

  const tick = side === 'self' ? '<span class="tick">✓</span>' : '';

  div.innerHTML = `
    <div class="bubble-text">${escHtml(text)}</div>
    <div class="bubble-meta">${badge}<span class="ts">${time}</span>${tick}</div>
  `;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.getElementById(id).style.display = 'flex';
}

function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tab-login').classList.toggle('active', isLogin);
  document.getElementById('tab-register').classList.toggle('active', !isLogin);
  document.getElementById('login-form').style.display    = isLogin ? 'flex' : 'none';
  document.getElementById('register-form').style.display = isLogin ? 'none' : 'flex';
  setAuthError('');
}

function setAuthError(msg) {
  document.getElementById('auth-error').textContent = msg;
}
function setAuthLoading(on) {
  document.querySelectorAll('#auth-view button[type=submit]').forEach(b => b.disabled = on);
}
function setStatusBar(msg, level = '') {
  const bar = document.getElementById('status-bar');
  bar.textContent  = msg;
  bar.className    = 'status-bar ' + level;
  bar.style.display = msg ? 'block' : 'none';
}
function showNotification(title, body) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.ico' });
  }
}
function markUserUnread(userId) {
  const li = document.querySelector(`.user-item[data-id="${userId}"]`);
  if (li && !li.querySelector('.unread-dot')) {
    const dot = document.createElement('span');
    dot.className = 'unread-dot';
    li.appendChild(dot);
  }
}
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}