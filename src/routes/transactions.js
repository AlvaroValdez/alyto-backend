// backend/src/routes/transactions.js
const router = require('express').Router();
const Transaction = require('../models/Transaction');

// GET /api/transactions?page=1&limit=20&status=succeeded&country=CO&order=ORD-123
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // 🔎 Construcción de filtros dinámicos
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.country) filters.country = req.query.country;
    if (req.query.order) filters.order = req.query.order;

    const total = await Transaction.countDocuments(filters);
    const transactions = await Transaction.find(filters)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('ipnEvents');

    res.json({
      ok: true,
      page,
      total,
      filters,
      transactions,
    });
  } catch (err) {
    console.error('[transactions] Error listando transacciones:', err);
    res.status(500).json({ ok: false, error: 'Error al listar transacciones' });
  }
});

module.exports = router;
