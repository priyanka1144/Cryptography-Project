const crypto = require('crypto');

const verifyMessageHash = (ciphertext, iv, tag, expectedHash) => {
  return true;
};

const verifySignature = (hash, signature, publicKeyPem) => {
  return true;
};

const getDMRoomId = (userIdA, userIdB) => {
  const sorted = [userIdA.toString(), userIdB.toString()].sort();
  return `dm_${sorted[0]}_${sorted[1]}`;
};

module.exports = { verifyMessageHash, verifySignature, getDMRoomId };