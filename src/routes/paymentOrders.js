import { Router } from 'express';
import {
  createPaymentOrder,
  getPaymentMethods,
  executeDirectPayment
} from '../services/vitaService.js';
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

// GET /api/payment-orders/methods/:country
// Obtiene los métodos reales desde Vita Wallet
router.get('/methods/:country', protect, async (req, res) => {
  try {
    const { country } = req.params;
    // Llamamos al servicio (asegurando que el país vaya en mayúsculas por si acaso)
    const methods = await getPaymentMethods(country.toUpperCase());

    res.json({ ok: true, data: methods });
  } catch (e) {
    console.error('[paymentOrders] Error obteniendo métodos:', e.message);
    res.status(500).json({ ok: false, error: 'Error al obtener métodos de pago', details: e.message });
  }
});

// POST /api/payment-orders (Paso 1 del pago: Crear la Orden)
router.post('/', protect, async (req, res) => {
  try {
    const { amount, country, orderId } = req.body;

    if (!amount || !country || !orderId) {
      return res.status(400).json({ ok: false, error: 'Faltan datos requeridos (amount, country, orderId).' });
    }

    // URL a la que Vita redirigirá si el pago es exitoso (para flujos redirect)
    const successRedirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment-success?orderId=${orderId}`;

    const payload = {
      amount: Math.round(Number(amount)),
      country_iso_code: country,
      issue: `Pago de remesa #${orderId}`,
      success_redirect_url: successRedirectUrl,
      // Opcional: Agregar datos del cliente si Vita lo requiere para scoring
      user_email: req.user.email
    };

    const response = await createPaymentOrder(payload);

    // Devolvemos la respuesta de Vita (que incluye el 'uid' necesario para el paso 2)
    res.status(201).json({ ok: true, data: response });

  } catch (e) {
    console.error('[paymentOrders] Error creando orden:', e.message);

    if (e.response) {
      return res.status(e.response.status).json({
        ok: false,
        error: 'Error de Vita Wallet',
        details: e.response.data
      });
    }

    res.status(500).json({ ok: false, error: 'Error interno al crear orden de pago.' });
  }
});

// POST /api/payment-orders/:vitaOrderId/execute (Paso 2 del pago: Ejecutar Directo)
router.post('/:vitaOrderId/execute', protect, async (req, res) => {
  try {
    const { vitaOrderId } = req.params;
    const { payment_data } = req.body; // Datos del formulario (token, email, rut, etc.)

    if (!payment_data) {
      return res.status(400).json({ ok: false, error: 'Faltan datos de pago (payment_data).' });
    }

    // --- CORRECCIÓN CRÍTICA ---
    // El servicio 'executeDirectPayment' espera UN solo objeto.
    // Vita requiere que el 'uid' (vitaOrderId) vaya dentro del payload.
    const payload = {
      uid: vitaOrderId, // ID de la orden creado en el Paso 1
      ...payment_data   // Datos sensibles del medio de pago
    };

    const response = await executeDirectPayment(payload);

    res.json({ ok: true, data: response });

  } catch (e) {
    console.error('❌ Error en pago directo:', e.message);

    if (e.response) {
      // Devolvemos el error exacto de Vita para que el frontend sepa qué falló (ej: saldo insuficiente)
      return res.status(e.response.status).json({
        ok: false,
        error: 'Error de Vita Wallet al procesar pago',
        details: e.response.data
      });
    }

    res.status(500).json({ ok: false, error: 'Error interno ejecutando el pago.' });
  }
});

export default router;