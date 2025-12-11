import express from 'express';
import { getListPrices } from '../services/vitaService.js';

const router = express.Router();

// Mapa auxiliar para convertir Moneda -> País (Si Vita devuelve COP y el Front espera CO)
// Esto soluciona el problema de que el dropdown salga vacío si hay desajuste de códigos.
const CURRENCY_TO_COUNTRY = {
  'COP': 'co', 'ARS': 'ar', 'PEN': 'pe', 'MXN': 'mx', 'BRL': 'br',
  'CLP': 'cl', 'USD': 'us', 'EUR': 'eu', 'VEF': 've', 'VES': 've'
};

// GET /api/fx/quote
router.get('/quote', async (req, res) => {
  try {
    const origin = String(req.query.origin || 'CLP').toUpperCase();
    const destInput = String(req.query.destCountry || '').toUpperCase(); // Puede venir como 'CO' o 'COP'
    const amount = Number(req.query.amount || 0);

    if (!destInput) {
      return res.status(400).json({ ok: false, error: 'destCountry es requerido' });
    }

    // 1. Obtener precios frescos
    const prices = await getListPrices();

    // 2. Buscar la tasa correcta
    // El Front puede mandar "CO" (País) pero Vita Business devuelve "COP" (Moneda).
    // Buscamos coincidencia en ambos sentidos.
    const priceData = prices.find(p =>
      p.code === destInput || // Match directo (COP === COP)
      CURRENCY_TO_COUNTRY[p.code]?.toUpperCase() === destInput // Match por país (COP -> CO === CO)
    );

    if (!priceData || !priceData.rate) {
      console.warn(`⚠️ Tasa no encontrada para: ${origin} -> ${destInput}`);
      return res.status(422).json({
        ok: false,
        error: `No se encontró tasa de cambio para ${destInput}. Disponibles: ${prices.map(p => p.code).join(', ')}`,
      });
    }

    const baseRate = priceData.rate;

    // 3. (Opcional) Markup - Por ahora 0% para probar funcionalidad
    const markupPercent = 0.0;
    const rateWithMarkup = baseRate * (1 + markupPercent);
    const amountOut = Number((amount * rateWithMarkup).toFixed(2));

    return res.json({
      ok: true,
      quote: {
        origin,
        destCountry: destInput, // Devolvemos lo que pidió el front
        currency: priceData.code, // Confirmamos la moneda usada
        amountIn: amount,
        baseRate,
        markupPercent,
        rateWithMarkup,
        amountOut,
      },
    });

  } catch (err) {
    console.error("❌ Error en /quote:", err);
    const status = err?.response?.status || 500;
    const message = err?.response?.data?.message || err.message || 'Error generando cotización';
    return res.status(status).json({ ok: false, error: message });
  }
});

export default router;