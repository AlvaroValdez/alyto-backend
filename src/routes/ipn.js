const router = require('express').Router();
const { verifyVitaSignature } = require('../middleware/vitaSignature');

router.post('/vita', verifyVitaSignature, async (req, res) => {
  const event = req.body;

  console.log('[ipn] Evento Vita recibido:', event);

  if (event?.type === 'payment.succeeded') {
    // TODO: actualizar transacción en DB como "succeeded"
  }

  res.json({ ok: true });
});

module.exports = router;
