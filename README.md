# 🔐 SecureChat — Secure Real-Time Messaging System

End-to-end encrypted chat using **AES-256-GCM**, **RSA-2048**, **SHA-512**, **RSA-PSS digital signatures**, and **JWT (RS256)** authentication over **Socket.IO / WebSocket**.

---

## Project Structure

```
secure-chat/
├── backend/
│   ├── config/
│   │   ├── db.js           — MongoDB connection
│   │   └── keys.js         — RSA key pair loader / generator (for JWT)
│   ├── middleware/
│   │   └── auth.js         — JWT verify middleware (HTTP + Socket.IO)
│   ├── models/
│   │   ├── User.js         — User schema (stores RSA public key, bcrypt hash)
│   │   └── Message.js      — Message schema (encrypted payload only)
│   ├── routes/
│   │   ├── auth.js         — /api/auth/* (register, login, refresh, logout, keys)
│   │   ├── users.js        — /api/users/* (list, get public key)
│   │   └── messages.js     — /api/messages/:userId (history)
│   ├── services/
│   │   └── crypto.js       — Server-side hash verification + signature check
│   ├── socket/
│   │   └── index.js        — Socket.IO event handlers
│   ├── .env                — Environment variables
│   ├── package.json
│   └── server.js           — Entry point
│
└── frontend/
    ├── css/
    │   └── style.css
    ├── js/
    │   ├── crypto.js       — Web Crypto API: AES-GCM, RSA-OAEP, RSA-PSS, SHA-512
    │   ├── api.js          — HTTP client with auto token refresh
    │   └── app.js          — Main app controller
    └── index.html
```

---

## Setup & Run

### Prerequisites
- Node.js 18+
- MongoDB running locally (`mongod`) or a MongoDB Atlas URI

### 1. Install dependencies
```bash
cd secure-chat/backend
npm install
```

### 2. Configure environment
Edit `backend/.env`:
```env
PORT=3000
MONGO_URI=mongodb://localhost:27017/securechat
CORS_ORIGIN=http://localhost:3000
```

### 3. (Optional) Pre-generate JWT RSA keys
```bash
cd backend/config
openssl genrsa -out jwt_private.pem 2048
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem
```
If you skip this step, keys are auto-generated on first startup and saved to `backend/config/`.

### 4. Start the server
```bash
# From backend/
npm start          # production
npm run dev        # with nodemon (hot reload)
```

### 5. Open the app
Visit **http://localhost:3000** in two different browser windows (or use two browsers).
Register two users, then select one from the sidebar to start an encrypted conversation.

---

## Security Architecture

### Message Flow (Sender → Recipient)

```
Plaintext
    │
    ▼
[AES-256-GCM encrypt]          ← ephemeral AES key per message
    │
    ├── ciphertext + IV + GCM tag
    │
    ├── [SHA-512 hash] of (ciphertext + IV + tag)    → integrity
    │
    ├── [RSA-PSS sign] hash with sender's private key → authenticity
    │
    └── [RSA-OAEP wrap] AES key with recipient's public key → key exchange
    │
    ▼
Socket.IO (WSS/TLS 1.3)
    │
    ▼
Server: verifies SHA-512 hash + RSA-PSS signature (rejects tampered messages)
    │
    ▼
Recipient: verifies signature → checks hash → unwraps AES key → decrypts
    │
    ▼
Plaintext (only ever on recipient's device)
```

### Key Storage
| Key | Where stored | Who can access |
|-----|-------------|----------------|
| User RSA private key | Browser IndexedDB | Only the local user |
| User RSA public key | MongoDB | Anyone (public) |
| JWT signing private key | Server filesystem (`config/jwt_private.pem`) | Server only |
| AES session key | Never persisted — ephemeral | Recipient only (wrapped in RSA) |

### Cryptographic Algorithms
| Purpose | Algorithm |
|---------|-----------|
| Message encryption | AES-256-GCM |
| Key exchange | RSA-2048-OAEP (SHA-256) |
| Digital signature | RSA-2048-PSS (SHA-512) |
| Integrity hash | SHA-512 |
| JWT signing | RS256 (RSA-2048 + SHA-256) |
| Password hashing | bcrypt (rounds=12) |
| Transport | TLS 1.3 (WSS) |

---

## API Reference

### Auth
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | `{username, email, password}` | Create account |
| POST | `/api/auth/login` | `{username, password}` | Login → JWT |
| POST | `/api/auth/refresh` | `{refreshToken}` | Rotate tokens |
| POST | `/api/auth/logout` | — | Revoke refresh token |
| GET  | `/api/auth/me` | — | Current user info |
| PUT  | `/api/auth/keys` | `{publicKey}` | Upload RSA public key |

### Users
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List all users |
| GET | `/api/users/:id/publickey` | Get user's RSA public key |

### Messages
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/messages/:userId` | Fetch DM history (encrypted) |

### Socket.IO Events
| Event | Direction | Payload |
|-------|-----------|---------|
| `message:send` | client → server | `{recipientId, ciphertext, iv, tag, encryptedKey, signature, hash}` |
| `message:receive` | server → client | Same + `{messageId, senderId, senderName, createdAt}` |
| `message:delivered` | server → sender | `{messageId}` |
| `message:read` | client → server | `{messageId}` |
| `message:read_receipt` | server → sender | `{messageId}` |
| `typing:start/stop` | client → server | `{recipientId}` |
| `user:status` | server → all | `{userId, isOnline}` |

---

## Notes for Submission / Presentation

- **The server never sees plaintext** — all encryption/decryption happens in the browser
- **RSA private keys never leave the client** — stored in IndexedDB only
- **Every message is independently encrypted** with a fresh AES key
- **Digital signatures** provide non-repudiation — the recipient can prove who sent the message
- **Hash verification** on both server and client — two independent integrity layers
