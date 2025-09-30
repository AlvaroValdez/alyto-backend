// backend/src/routes/ipn.js
const router = require('express').Router();
const { verifyVitaSignature } = require('../middleware/vitaSignature');
const VitaEvent = require('../models/VitaEvent');
const Transaction = require('../models/Transaction');

router.post('/vita', verifyVitaSignature, async (req, res) => {
  const event = req.body;

  // 🔎 Logs forzados para Render
  process.stdout.write('[ipn] Evento Vita recibido: ' + JSON.stringify(event) + '\n');
  process.stdout.write('[ipn] Headers recibidos: ' + JSON.stringify(req.headers) + '\n');
  process.stdout.write('[ipn] Body recibido (raw): ' + JSON.stringify(event) + '\n');

  try {
    // Guardar en Mongo
    const vitaEvent = await VitaEvent.create({
      vitaId: event?.id,
      type: event?.type || 'unknown',
      payload: event,
      headers: req.headers,
      verified: true,
    });

    // Actualizar transacción si aplica
    if (event?.type === 'payment.succeeded') {
      await Transaction.findOneAndUpdate(
        { order: event?.object?.order },
        { status: 'succeeded', $push: { ipnEvents: vitaEvent._id } }
      );
    } else if (event?.type === 'payment.failed') {
      await Transaction.findOneAndUpdate(
        { order: event?.object?.order },
        { status: 'failed', $push: { ipnEvents: vitaEvent._id } }
      );
    }

    res.json({ ok: true, id: vitaEvent._id });
  } catch (err) {
    process.stderr.write('[ipn] Error guardando evento Vita: ' + err.message + '\n');
    res.status(500).json({ ok: false, error: 'Error al persistir evento' });
  }
});

module.exports = router;
