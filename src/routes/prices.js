const router = require('express').Router();
const { getListPrices } = require('../services/vitaService');

router.get('/', async (req, res, next) => {
  try {
    // La caché ahora está dentro de getListPrices(), por lo que esta llamada es segura y rápida.
    const data = await getListPrices();
    res.json({ ok: true, data });
  } catch (e) { 
    next(e); 
  }
});

module.exports = router;