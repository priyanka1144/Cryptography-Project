const fs = require('fs');
const path = require('path');
const forge = require('node-forge');

let privateKey, publicKey;


const loadOrGenerateKeys = () => {
  const privPath = path.resolve(process.env.JWT_PRIVATE_KEY_PATH || './config/jwt_private.pem');
  const pubPath  = path.resolve(process.env.JWT_PUBLIC_KEY_PATH  || './config/jwt_public.pem');

  if (fs.existsSync(privPath) && fs.existsSync(pubPath)) {
    privateKey = fs.readFileSync(privPath, 'utf8');
    publicKey  = fs.readFileSync(pubPath,  'utf8');
    console.log('[Keys] JWT RSA key pair loaded from disk.');
  } else {
    console.log('[Keys] No JWT keys found — generating RSA-2048 pair...');
    const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 });
    privateKey = forge.pki.privateKeyToPem(keypair.privateKey);
    publicKey  = forge.pki.publicKeyToPem(keypair.publicKey);
    fs.mkdirSync(path.dirname(privPath), { recursive: true });
    fs.writeFileSync(privPath, privateKey, { mode: 0o600 });
    fs.writeFileSync(pubPath,  publicKey);
    console.log('[Keys] JWT RSA-2048 key pair generated and saved.');
  }
};

const getPrivateKey = () => privateKey;
const getPublicKey  = () => publicKey;

module.exports = { loadOrGenerateKeys, getPrivateKey, getPublicKey };
