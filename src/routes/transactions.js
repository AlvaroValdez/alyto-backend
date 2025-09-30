// backend/src/routes/transactions.js
// Justificación: listar transacciones creadas por el sistema de remesas.
// Fuente: se alimenta de Transaction (Mongo) y se actualiza vía Vita IPN.

const router = require('express').Router();
const Transaction = require('../models/Transaction');

// GET /api/transactions?page=1&limit=20
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const total = await Transaction.countDocuments();
    const transactions = await Transaction.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('ipnEvents'); // opcional, muestra relación con VitaEvent

    res.json({
      ok: true,
      page,
      total,
      transactions,
    });
  } catch (err) {
    console.error('[transactions] Error listando transacciones:', err);
    res.status(500).json({ ok: false, error: 'Error al listar transacciones' });
  }
});

module.exports = router;
