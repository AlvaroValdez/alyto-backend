import express from 'express';
import { getListPrices } from '../services/vitaService.js';

const router = express.Router();

// GET /api/prices
router.get('/', async (req, res) => {
  try {
    // 1. Obtenemos los precios (reales o mockeados del servicio)
    const prices = await getListPrices();

    // 2. 🔥 CORRECCIÓN CRÍTICA:
    // Envolvemos el array en un objeto { ok: true, data: ... }
    // Esto es lo que el Frontend busca para renderizar la lista.
    return res.status(200).json({
      ok: true,
      data: prices
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