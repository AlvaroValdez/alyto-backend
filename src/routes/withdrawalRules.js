// backend/src/routes/withdrawalRules.js
// Fuente Vita: GET /api/businesses/withdrawal_rules
// Justificación: proxy directo para exponer campos dinámicos de retiro

const router = require('express').Router();
const { getWithdrawalRules } = require('../services/vitaService');

router.get('/', async (req, res, next) => {
  try {
    const data = await getWithdrawalRules();
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

module.exports = router;