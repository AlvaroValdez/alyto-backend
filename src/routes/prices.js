import express from 'express';
import { getListPrices } from '../services/vitaService.js';
import { extractCountries } from '../utils/normalize.js';

const router = express.Router();

// GET /api/prices
router.get('/', async (req, res) => {
  try {
    const origin = String(req.query.origin || 'CLP').toUpperCase();

    // 1. Obtenemos los precios (reales o mockeados del servicio)
    const prices = await getListPrices();

    // 2. Normalizamos a lista de países (CO, AR, US...) usando la util
    // Esto asegura que el Frontend reciba códigos ISO-2 validos para su mapa de nombres.
    const normalizedCountries = extractCountries(prices, origin);

    // 3. Respuesta estándar
    return res.status(200).json({
      ok: true,
      data: normalizedCountries
    });

  } catch (err) {
    console.error("❌ Error en ruta /api/prices:", err.message);

    const status = err.response?.status || 500;
    const message = err.response?.data?.message || 'Error al obtener precios';

    return res.status(status).json({
      ok: false,
      error: message
    });
  }
});

export default router;