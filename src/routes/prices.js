// backend/src/routes/prices.js
const router = require('express').Router();
const { getListPrices } = require('../services/vitaService');

router.get('/', async (req, res, next) => {
  try {
    const data = await getListPrices();
    res.json({ ok: true, data });
  } catch (e) { next(e); }
});

module.exports = router;
