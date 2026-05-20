/**
 * crypto.js — Client-side cryptography using the Web Crypto API (zero dependencies).
 *
 * Responsibilities:
 *  - RSA-2048 key pair generation (stored in IndexedDB, never sent to server)
 *  - AES-256-GCM encryption / decryption of messages
 *  - RSA-OAEP wrapping / unwrapping of AES session keys
 *  - RSA-PSS signing / verification over SHA-512 hashes
 *  - SHA-512 hashing for integrity
 */

const DB_NAME    = 'securechat-keys';
const DB_VERSION = 1;
const STORE_NAME = 'keypairs';
const KEY_ID     = 'user-rsa-keypair';

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

const openKeyDB = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE_NAME);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });

const dbGet = async (db, key) =>
  new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });

const dbPut = async (db, key, value) =>
  new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });

// ── Encoding helpers ──────────────────────────────────────────────────────────

const toBase64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const toHex  = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');

const pemToBuffer = (pem) => {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return fromBase64(b64);
};

const bufferToPem = (buf, type) => {
  const b64 = toBase64(buf);
  const lines = b64.match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${type}-----\n${lines}\n-----END ${type}-----`;
};

// ── RSA Key Pair ──────────────────────────────────────────────────────────────

/**
 * Generate or load a persistent RSA-2048 key pair from IndexedDB.
 * Returns { privateKey, publicKey } as CryptoKey objects.
 */
const getOrCreateKeyPair = async () => {
  const db       = await openKeyDB();
  const existing = await dbGet(db, KEY_ID);

  if (existing) {
    const privateKey = await crypto.subtle.importKey(
      'pkcs8', existing.privateKeyBuf,
      { name: 'RSA-PSS', hash: 'SHA-512' },
      true, ['sign']
    );
    // Import for OAEP decryption too
    const decryptKey = await crypto.subtle.importKey(
      'pkcs8', existing.privateKeyBuf,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true, ['unwrapKey', 'decrypt']
    );
    const publicKey = await crypto.subtle.importKey(
      'spki', existing.publicKeyBuf,
      { name: 'RSA-PSS', hash: 'SHA-512' },
      true, ['verify']
    );
    const encryptKey = await crypto.subtle.importKey(
      'spki', existing.publicKeyBuf,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true, ['wrapKey', 'encrypt']
    );
    return { signKey: privateKey, decryptKey, verifyKey: publicKey, encryptKey,
             privateKeyBuf: existing.privateKeyBuf, publicKeyBuf: existing.publicKeyBuf };
  }

  // Generate fresh key pair (sign/verify — RSA-PSS)
  const sigPair = await crypto.subtle.generateKey(
    { name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-512' },
    true, ['sign', 'verify']
  );
  // Generate fresh key pair (encrypt/decrypt — RSA-OAEP)
  const oaepPair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' },
    true, ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
  );

  // Export and store raw key material (private key is extractable so we can persist it)
  const privateKeyBuf = await crypto.subtle.exportKey('pkcs8', sigPair.privateKey);
  const publicKeyBuf  = await crypto.subtle.exportKey('spki',  sigPair.publicKey);

  await dbPut(db, KEY_ID, { privateKeyBuf, publicKeyBuf });

  return {
    signKey: sigPair.privateKey, decryptKey: oaepPair.privateKey,
    verifyKey: sigPair.publicKey, encryptKey: oaepPair.publicKey,
    privateKeyBuf, publicKeyBuf,
  };
};

/**
 * Export the user's RSA public key as PEM (SPKI format) to upload to the server.
 */
const exportPublicKeyPem = async (publicKeyBuf) =>
  bufferToPem(publicKeyBuf, 'PUBLIC KEY');

/**
 * Import a recipient's RSA public key (PEM) for encryption.
 */
const importRecipientPublicKey = async (pem) => {
  const buf = pemToBuffer(pem);
  return crypto.subtle.importKey(
    'spki', buf,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false, ['encrypt']
  );
};

// ── AES-256-GCM Encryption ────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string for a recipient.
 * Returns: { ciphertext, iv, tag, encryptedKey, signature, hash } — all base64/hex strings.
 */
const encryptMessage = async (plaintext, recipientPublicKeyPem, senderKeys) => {
  // 1. Generate ephemeral AES-256-GCM key
  const aesKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
  );

  // 2. Encrypt plaintext
  const iv         = crypto.getRandomValues(new Uint8Array(12));
  const encoded    = new TextEncoder().encode(plaintext);
  const encrypted  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aesKey, encoded);

  // AES-GCM appends the 16-byte tag at the end of the ciphertext buffer
  const fullBuf    = new Uint8Array(encrypted);
  const cipherBuf  = fullBuf.slice(0, fullBuf.length - 16);
  const tagBuf     = fullBuf.slice(fullBuf.length - 16);

  const ciphertext = toBase64(cipherBuf);
  const ivB64      = toBase64(iv);
  const tag        = toBase64(tagBuf);

  // 3. Wrap AES key with recipient's RSA-OAEP public key
  const recipientKey  = await importRecipientPublicKey(recipientPublicKeyPem);
  const rawAesKey     = await crypto.subtle.exportKey('raw', aesKey);
  const encryptedKeyBuf = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, recipientKey, rawAesKey);
  const encryptedKey  = toBase64(encryptedKeyBuf);

  // 4. SHA-512 hash of ciphertext + iv + tag (for integrity)
  const hashInput  = new TextEncoder().encode(ciphertext + ivB64 + tag);
  const hashBuf    = await crypto.subtle.digest('SHA-512', hashInput);
  const hash       = toHex(hashBuf);

  // 5. RSA-PSS sign the hash
  const hashBytes  = new TextEncoder().encode(hash);
  const sigBuf     = await crypto.subtle.sign(
    { name: 'RSA-PSS', saltLength: 64 },
    senderKeys.signKey,
    hashBytes
  );
  const signature = toBase64(sigBuf);

  return { ciphertext, iv: ivB64, tag, encryptedKey, signature, hash };
};

// ── AES-256-GCM Decryption ────────────────────────────────────────────────────

/**
 * Decrypt a received message payload.
 * Verifies signature and hash before decrypting.
 * Returns plaintext string, or throws on any verification failure.
 */
const decryptMessage = async (payload, recipientKeys, senderPublicKeyPem) => {
  const { ciphertext, iv, tag, encryptedKey, signature, hash } = payload;

  // 1. Re-compute SHA-512 hash and compare
  const hashInput   = new TextEncoder().encode(ciphertext + iv + tag);
  const hashBuf     = await crypto.subtle.digest('SHA-512', hashInput);
  const recomputed  = toHex(hashBuf);

  if (recomputed !== hash) {
    throw new Error('Hash mismatch — message may have been tampered with!');
  }

  // 2. Verify RSA-PSS signature against sender's public key
  const senderVerifyKey = await importSenderVerifyKey(senderPublicKeyPem);
  const hashBytes       = new TextEncoder().encode(hash);
  const sigValid = await crypto.subtle.verify(
    { name: 'RSA-PSS', saltLength: 64 },
    senderVerifyKey,
    fromBase64(signature),
    hashBytes
  );
  if (!sigValid) {
    throw new Error('Invalid digital signature — sender authenticity cannot be confirmed!');
  }

  // 3. Unwrap AES key using recipient's RSA private key
  const rawAesKey = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    recipientKeys.decryptKey,
    fromBase64(encryptedKey)
  );
  const aesKey = await crypto.subtle.importKey(
    'raw', rawAesKey, { name: 'AES-GCM' }, false, ['decrypt']
  );

  // 4. Decrypt (re-append tag since Web Crypto expects combined ciphertext+tag)
  const cipherBuf  = fromBase64(ciphertext);
  const tagBuf     = fromBase64(tag);
  const combined   = new Uint8Array(cipherBuf.length + tagBuf.length);
  combined.set(cipherBuf);
  combined.set(tagBuf, cipherBuf.length);

  const plainBuf   = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv), tagLength: 128 },
    aesKey,
    combined
  );

  return new TextDecoder().decode(plainBuf);
};

const importSenderVerifyKey = (pem) => {
  const buf = pemToBuffer(pem);
  return crypto.subtle.importKey(
    'spki', buf,
    { name: 'RSA-PSS', hash: 'SHA-512' },
    false, ['verify']
  );
};

// ── Exports ───────────────────────────────────────────────────────────────────

window.SecureCrypto = {
  getOrCreateKeyPair,
  exportPublicKeyPem,
  encryptMessage,
  decryptMessage,
};
