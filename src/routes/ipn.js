// backend/src/routes/ipn.js
const router = require('express').Router();
const { verifyVitaSignature } = require('../middleware/vitaSignature');
const VitaEvent = require('../models/VitaEvent');

router.post('/vita', verifyVitaSignature, async (req, res) => {
  const event = req.body;

  // 🔎 Logs forzados para Render
  process.stdout.write('[ipn] Headers recibidos: ' + JSON.stringify(req.headers) + '\n');
  process.stdout.write('[ipn] Body recibido (raw): ' + JSON.stringify(event) + '\n');

  try {
    // Guardar en Mongo
    const vitaEvent = await VitaEvent.create({
      vitaId: event?.id,
      type: event?.type || 'unknown',
      payload: event,
      headers: req.headers,
      verified: true
    });

    process.stdout.write('[ipn] Evento Vita guardado en DB: ' + vitaEvent._id + '\n');

    res.json({ ok: true, id: vitaEvent._id });
  } catch (err) {
    process.stderr.write('[ipn] Error guardando evento Vita: ' + err.message + '\n');
    res.status(500).json({ ok: false, error: 'Error al persistir evento' });
  }
});

module.exports = router;
