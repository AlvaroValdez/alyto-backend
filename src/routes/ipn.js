const router = require('express').Router();
const { verifyVitaSignature } = require('../middleware/vitaSignature');
const VitaEvent = require('../models/VitaEvent');

router.post('/vita', verifyVitaSignature, async (req, res) => {
  const event = req.body;

  // 🔎 Log forzado aunque esté vacío
  console.log('[ipn] Headers recibidos:', req.headers);
  console.log('[ipn] Body recibido (raw):', JSON.stringify(event));

  try {
    // Guardar en Mongo
    const vitaEvent = await VitaEvent.create({
      vitaId: event?.id,
      type: event?.type || 'unknown',
      payload: event,
      headers: req.headers,
      verified: true
    });

    console.log('[ipn] Evento Vita guardado en DB:', vitaEvent._id);

    // Responder OK
    res.json({ ok: true, id: vitaEvent._id });
  } catch (err) {
    console.error('[ipn] Error guardando evento Vita:', err);
    res.status(500).json({ ok: false, error: 'Error al persistir evento' });
  }
});

module.exports = router;
