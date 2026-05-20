/**
 * api.js — HTTP API client with automatic token refresh.
 */

const BASE = '';  // Same origin as server

class APIClient {
  constructor() {
    this.accessToken  = localStorage.getItem('accessToken');
    this.refreshToken = localStorage.getItem('refreshToken');
  }

  setTokens(access, refresh) {
    this.accessToken  = access;
    this.refreshToken = refresh;
    localStorage.setItem('accessToken',  access);
    localStorage.setItem('refreshToken', refresh);
  }

  clearTokens() {
    this.accessToken  = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('currentUser');
  }

  async _fetch(path, options = {}, retry = true) {
    const res = await fetch(BASE + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        ...(options.headers || {}),
      },
    });

    // Auto-refresh on 401
    if (res.status === 401 && retry && this.refreshToken) {
      const refreshed = await this._tryRefresh();
      if (refreshed) return this._fetch(path, options, false);
      this.clearTokens();
      window.location.href = '/';
      return;
    }

    return res.json();
  }

  async _tryRefresh() {
    try {
      const res = await fetch(`${BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      this.setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  register(username, email, password) {
    return this._fetch('/api/auth/register', {
      method: 'POST', body: JSON.stringify({ username, email, password }),
    });
  }

  async login(username, password) {
    const data = await this._fetch('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }),
    });
    if (data.accessToken) {
      this.setTokens(data.accessToken, data.refreshToken);
      localStorage.setItem('currentUser', JSON.stringify(data.user));
    }
    return data;
  }

  logout() {
    return this._fetch('/api/auth/logout', { method: 'POST' });
  }

  uploadPublicKey(publicKeyPem) {
    return this._fetch('/api/auth/keys', {
      method: 'PUT', body: JSON.stringify({ publicKey: publicKeyPem }),
    });
  }

  me() { return this._fetch('/api/auth/me'); }

  // ── Users ─────────────────────────────────────────────────────────────────
  getUsers() { return this._fetch('/api/users'); }

  getUserPublicKey(userId) { return this._fetch(`/api/users/${userId}/publickey`); }

  // ── Messages ──────────────────────────────────────────────────────────────
  getMessages(userId, limit = 50, skip = 0) {
    return this._fetch(`/api/messages/${userId}?limit=${limit}&skip=${skip}`);
  }
}

window.API = new APIClient();
