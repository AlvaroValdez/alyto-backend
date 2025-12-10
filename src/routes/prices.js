import { Router } from 'express';
import { getListPrices } from '../services/vitaService.js';

const router = Router();

// GET /api/prices
router.get('/', async (req, res) => {
  try {
    console.log('🔍 [prices] Solicitando lista de precios a Vita Wallet...');

    // 1. Llamada al servicio
    const response = await getListPrices();

    console.log('📦 [prices] Respuesta cruda de Vita:', JSON.stringify(response, null, 2));

    // 2. Normalización de datos
    // A veces Vita devuelve { data: [...] } o { prices: [...] } o directamente [...]
    let pricesData = [];

    if (Array.isArray(response)) {
      pricesData = response;
    } else if (response && Array.isArray(response.data)) {
      pricesData = response.data;
    } else if (response && Array.isArray(response.prices)) {
      pricesData = response.prices;
    } else {
      console.warn('⚠️ [prices] Estructura desconocida recibida:', response);
    }

    // 3. Respuesta al Frontend
    // El frontend espera { ok: true, data: [...] }
    res.json({
      ok: true,
      data: pricesData
    });

  } catch (error) {
    console.error("❌ [prices] Error fatal:", error.message);
    if (error.response) {
      console.error("🔥 [prices] Detalle error Vita:", error.response.data);
    }
    // No devolvemos 500 para no romper el frontend, enviamos array vacío
    res.json({ ok: false, data: [], error: 'Error al cargar precios' });
  }
});

export default router;