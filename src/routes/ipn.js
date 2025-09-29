// backend/src/routes/ipn.js
const router = require('express').Router();
const { verifyVitaSignature } = require('../middleware/vitaSignature');

router.post('/vita', verifyVitaSignature, async (req, res) => {
  const event = req.body;
  // TODO: persistir en DB si quieres auditoría
  // Ejemplo reactivo:
  if (event?.type === 'payment.succeeded') {
    // disparar lógica interna (e.g., marcar saldo disponible o trigger de payout)
  }
  res.json({ ok: true });
});

module.exports = router;
