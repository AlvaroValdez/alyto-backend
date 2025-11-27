import { Router } from 'express';
import { createPaymentOrder, getPaymentMethods, executeDirectPayment } from '../services/vitaService.js';

const router = Router();

// GET /api/payment-orders/methods/:country
// Obtiene los métodos reales desde Vita Wallet
router.get('/methods/:country', async (req, res) => {
  try {
    const { country } = req.params;
    const methods = await getPaymentMethods(country);
    res.json({ ok: true, data: methods });
  } catch (e) {
    console.error('[paymentOrders] Error obteniendo métodos:', e.message);
    res.status(500).json({ ok: false, error: 'Error al obtener métodos de pago' });
  }
});

// POST /api/payment-orders (Paso 1 del pago: Crear la Orden)
router.post('/', async (req, res, next) => {
  try {
    const { amount, country, orderId } = req.body;
    if (!amount || !country || !orderId) {
      return res.status(400).json({ ok: false, error: 'Faltan datos requeridos.' });
    }

    const successRedirectUrl = `${process.env.FRONTEND_URL}/payment-success?orderId=${orderId}`;

    const payload = {
      amount: Math.round(Number(amount)),
      country_iso_code: country,
      issue: `Pago de remesa #${orderId}`,
      success_redirect_url: successRedirectUrl,
    };

    const response = await createPaymentOrder(payload);
    // Importante: Devolvemos toda la data, necesitamos el ID de la orden de Vita (no solo el nuestro)
    res.status(201).json({ ok: true, data: response });
  } catch (e) {
    next(e);
  }
});

// POST /api/payment-orders/:vitaOrderId/execute (Paso 2 del pago: Ejecutar Directo)
router.post('/:vitaOrderId/execute', async (req, res, next) => {
  try {
    const { vitaOrderId } = req.params;
    const { payment_data } = req.body; // Datos del formulario (nombre, email, etc.)

    if (!payment_data) {
      return res.status(400).json({ ok: false, error: 'Faltan datos de pago (payment_data).' });
    }

    const response = await executeDirectPayment(vitaOrderId, payment_data);
    res.json({ ok: true, data: response });

  } catch (e) {
    console.error('❌ Error en pago directo:', e);
    // Manejo específico de errores de Vita (422, etc.)
    if (e.response) {
      return res.status(e.response.status).json({
        ok: false,
        error: 'Error de Vita Wallet',
        details: e.response.data
      });
    }
    next(e);
  }
});

export default router;