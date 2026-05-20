# Cryptography-Project
Real-time End-to-End Encrypted Chat Application using AES-256-GCM, RSA-2048, SHA-512, JWT, Socket.IO and MongoDB
# 🔐 SecureChat — End-to-End Encrypted Messaging System

A real-time chat application with end-to-end encryption using 
AES-256-GCM, RSA-2048, SHA-512, and Digital Signatures.

## 🛡️ Security Features
- **AES-256-GCM** — Message encryption
- **RSA-2048-OAEP** — Key exchange
- **RSA-2048-PSS** — Digital signatures
- **SHA-512** — Integrity verification
- **JWT RS256** — Authentication
- **bcrypt** — Password hashing
- **Socket.IO** — Real-time communication

## 🏗️ Tech Stack
- **Backend:** Node.js, Express.js, Socket.IO
- **Database:** MongoDB, Mongoose
- **Frontend:** Vanilla JavaScript, Web Crypto API
- **Auth:** JWT (RS256), bcrypt

## 📁 Project Structure

securechat/
├── backend/
│   ├── config/         # DB and JWT key config
│   ├── middleware/     # JWT auth middleware
│   ├── models/         # User and Message schemas
│   ├── routes/         # Auth, Users, Messages API
│   ├── services/       # Crypto verification
│   ├── socket/         # Socket.IO handlers
│   └── server.js       # Entry point
└── frontend/
├── css/            # Styles
├── js/             # Crypto, API, App logic
└── index.html      # UI

## ⚙️ Setup & Installation

### Prerequisites
- Node.js 18+
- MongoDB

### 1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/securechat-e2e-encrypted.git
cd securechat-e2e-encrypted
```

### 2. Install dependencies
```bash
cd backend
npm install
```

### 3. Configure environment
Create `.env` file in `backend/` folder:
```env
PORT=3000
NODE_ENV=development
MONGO_URI=mongodb://localhost:27017/securechat
JWT_PRIVATE_KEY_PATH=./config/jwt_private.pem
JWT_PUBLIC_KEY_PATH=./config/jwt_public.pem
JWT_EXPIRY=24h
JWT_REFRESH_EXPIRY=7d
BCRYPT_ROUNDS=12
CORS_ORIGIN=http://localhost:3000
```

### 4. Start MongoDB
```bash
mongod
```

### 5. Start the server
```bash
npm start
```

### 6. Open the app
Visit **http://localhost:3000** in two browser windows.
Register two users and start chatting securely!

## 🔐 How Encryption Works
Sender types "Hello"
↓
① AES-256-GCM encrypts the message
② SHA-512 hash ensures integrity
③ RSA-PSS signs the hash (authenticity)
④ RSA-OAEP wraps the AES key for recipient
↓
Server verifies hash + signature
Stores only encrypted data in MongoDB
↓
Recipient decrypts:
RSA private key → unwrap AES key → decrypt message

## 📡 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| POST | `/api/auth/refresh` | Refresh token |
| GET | `/api/users` | Get all users |
| GET | `/api/users/:id/publickey` | Get user public key |
| GET | `/api/messages/:userId` | Get message history |

## 🔌 Socket.IO Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `message:send` | Client → Server | Send encrypted message |
| `message:receive` | Server → Client | Receive message |
| `message:delivered` | Server → Sender | Delivery confirmation |
| `message:read` | Client → Server | Mark as read |
| `user:status` | Server → All | Online/Offline status |
| `typing:start/stop` | Client → Server | Typing indicator |

## 👥 Contributors
- Your Name

## 📄 License
MIT License
