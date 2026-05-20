const mongoose = require('mongoose');

/**
 * Messages are stored encrypted. The server never holds plaintext.
 *
 * Stored fields:
 *  - ciphertext    : AES-256-GCM encrypted message (base64)
 *  - iv            : AES GCM initialisation vector (base64)
 *  - tag           : AES GCM authentication tag (base64)
 *  - encryptedKey  : AES key wrapped with recipient's RSA public key (base64)
 *  - signature     : RSA-PSS signature over SHA-512(ciphertext+iv+tag) (base64)
 *  - hash          : SHA-512 hash of ciphertext+iv+tag (hex) — for integrity check
 */
const messageSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    
    ciphertext:   { type: String, required: true },
    iv:           { type: String, required: true },
    tag:          { type: String, required: true },
    encryptedKey: { type: String, required: true },
    signature:    { type: String, required: true },
    hash:         { type: String, required: true },

    delivered: { type: Boolean, default: false },
    read:      { type: Boolean, default: false },
  },
  { timestamps: true }
);

messageSchema.index({ roomId: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
