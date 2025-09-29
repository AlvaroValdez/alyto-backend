// backend/src/middleware/vitaSignature.js
const crypto = require('crypto');
const { vita } = require('../config/env');

function verifyVitaSignature(req, res, next) {
  try {
    const sig = req.header('Authorization') || '';
    if (!sig.startsWith('V2-HMAC-SHA256')) return res.status(401).send('Firma inválida');
    const payload = JSON.stringify(req.body || {});
    const expected = crypto.createHmac('sha256', vita.secret).update(payload).digest('hex');
    const received = sig.split('Signature:').pop()?.trim();
    if (expected !== received) return res.status(401).send('Firma no coincide');
    return next();
  } catch (e) {
    return res.status(400).send('Error verificando firma');
  }
}

module.exports = { verifyVitaSignature };
