// backend/src/routes/ipnEvents.js
// Fuente: Vita IPN - docs V2 HMAC
// Justificación: permitir al admin listar los eventos recibidos de Vita

const router = require('express').Router();
const VitaEvent = require('../models/VitaEvent');

// GET /api/ipn/events?page=1&limit=20
router.get('/events', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const total = await VitaEvent.countDocuments();
    const events = await VitaEvent.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      ok: true,
      page,
      total,
      events,
    });
  } catch (err) {
    console.error('[ipnEvents] Error listando eventos Vita:', err);
    res.status(500).json({ ok: false, error: 'Error al listar eventos Vita' });
  }
});

module.exports = router;
