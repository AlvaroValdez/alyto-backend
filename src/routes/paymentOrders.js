import { Router } from 'express';
import { createPaymentOrder, getPaymentMethods, executeDirectPayment } from '../services/vitaService.js';
import { vita } from '../config/env.js';

const router = Router();

// GET /api/payment-orders/methods/:country
// Obtiene los métodos reales desde Vita Wallet
router.get('/methods/:country', async (req, res) => {
  try {
    const { country } = req.params;
    console.log(`[paymentOrders] Solicitando métodos para país: ${country}`);
    const methods = await getPaymentMethods(country);
    console.log(`[paymentOrders] ✅ Métodos obtenidos:`, methods);
    return res.json({ ok: true, data: methods });
  } catch (e) {
    console.error('[paymentOrders] ❌ Error obteniendo métodos:', e.message);
    console.error('[paymentOrders] Error completo:', e.response?.data || e);
    return res.status(500).json({
      ok: false,
      error: 'Error al obtener métodos de pago',
      details: e.response?.data || e.message
    });
  }
});

// POST /api/payment-orders (Paso 1 del pago: Crear la Orden)
// backend/src/routes/paymentOrders.js
router.post('/', async (req, res, next) => {
  try {
    const { amount, country, orderId } = req.body || {};
    if (amount === undefined || amount === null || !country || !orderId) {
      return res.status(400).json({ ok: false, error: 'Faltan datos requeridos.' });
    }

    const frontendUrl = process.env.FRONTEND_URL || req.headers.origin || 'http://localhost:5173';
    const successRedirectUrl = `${frontendUrl}/#/payment-success/${encodeURIComponent(orderId)}`;

    const payload = {
      amount: Math.round(Number(amount)),
      country_iso_code: String(country).toUpperCase().trim(),
      issue: `Pago de remesa #${orderId}`,
      success_redirect_url: successRedirectUrl,
    };

    const response = await createPaymentOrder(payload);

    // Normaliza por si vitaService devuelve data o axios response
    const raw = response?.data ?? response;

    // Log útil (sin secretos) — AHORA sí se ejecuta
    console.log('[payment-orders] Vita response keys:', Object.keys(raw || {}));
    console.log('[payment-orders] Full response structure:', JSON.stringify(raw, null, 2));

    // ⭐ USAR LA URL QUE VITA DEVUELVE (attributes.url)
    // Vita devuelve una URL corta tipo: https://stage.vitawallet.io/s/XXXXX
    const checkoutUrl = raw?.attributes?.url || raw?.url || null;

    if (checkoutUrl) {
      console.log('[payment-orders] ✅ Checkout URL de Vita:', checkoutUrl);
    } else {
      console.error('[payment-orders] ❌ Vita no devolvió URL de checkout');
      console.error('[payment-orders] Response:', raw);
    }

    return res.status(201).json({
      ok: true,
      checkoutUrl,
      raw,
    });
  } catch (e) {
    return next(e);
  }
});

// POST /api/payment-orders/:vitaOrderId/execute (Paso 2 del pago: Ejecutar Directo)
router.post('/:vitaOrderId/execute', async (req, res, next) => {
  try {
    const { vitaOrderId } = req.params;
    const { method_id, payment_data, ...flat } = req.body || {};

    const details =
      payment_data && typeof payment_data === 'object'
        ? payment_data
        : flat;

    if (!details || Object.keys(details).length === 0) {
      return res.status(400).json({ ok: false, error: 'Faltan datos de pago.' });
    }

    const response = await executeDirectPayment({
      uid: vitaOrderId,
      method_id,
      ...details,
    });

    return res.json({ ok: true, data: response });
  } catch (e) {
    console.error('❌ Error en pago directo:', e?.message || e);

    // Manejo específico de errores de Vita (422, etc.)
    if (e.response) {
      return res.status(e.response.status).json({
        ok: false,
        error: 'Error de Vita Wallet',
        details: e.response.data,
      });
    }

    return next(e);
  }
});

export default router;