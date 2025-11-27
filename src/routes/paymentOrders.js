import { Router } from 'express';
import { createPaymentOrder } from '../services/vitaService.js';

const router = Router();

// --- MOCK: Requisitos de Pago Directo ---
router.get('/direct-requirements', (req, res) => {
  const mockRequirements = {
    payment_methods: [
      {
        method_id: "4820", // ID de Khipu o el método directo
        name: "Khipu",
        description: "Transferencia Bancaria Simplificada",
        country: "CL",
        required_fields: [
          { name: "first_name", type: "text", label: "Nombre", required: true, validation: { type: "string", max_length: 100 } },
          { name: "last_name", type: "text", label: "Apellido", required: true, validation: { type: "string", max_length: 100 } },
          { name: "email", type: "email", label: "Correo electrónico", required: true, validation: { type: "string", max_length: 255, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" } }
        ]
      }
    ]
  };
  res.json({ ok: true, data: mockRequirements });
});

// POST /api/payment-orders (Redirección Estándar)
router.post('/', async (req, res, next) => {
  try {
    const { amount, country, orderId } = req.body;
    if (!amount || !country || !orderId) {
      return res.status(400).json({ ok: false, error: 'Faltan datos requeridos.' });
    }

    const successRedirectUrl = `${process.env.FRONTEND_URL}/payment-success?orderId=${orderId}`;

    const payload = {
      amount: amount,
      country_iso_code: country,
      issue: `Pago de remesa, orden #${orderId}`,
      success_redirect_url: successRedirectUrl,
    };

    const paymentOrderResponse = await createPaymentOrder(payload);
    res.status(201).json({ ok: true, data: paymentOrderResponse });
  } catch (e) {
    console.error('❌ Error creando orden (redirect):', e);
    next(e);
  }
});

// --- RUTA CORREGIDA: PAGO DIRECTO / WHITE LABEL ---
router.post('/direct', async (req, res, next) => {
  try {
    // 1. Recibimos los datos extra: payer_details y method_id
    const { amount, country, orderId, payer_details, method_id } = req.body;

    if (!amount || !country || !orderId) {
      return res.status(400).json({ ok: false, error: 'Faltan datos requeridos.' });
    }

    const successRedirectUrl = `${process.env.FRONTEND_URL}/payment-success?orderId=${orderId}&method=direct`;

    // 2. Construimos el payload INCLUYENDO los datos de pago directo
    const payload = {
      amount: amount,
      country_iso_code: country,
      issue: `Pago Directo AVF #${orderId}`,
      success_redirect_url: successRedirectUrl,

      // --- AQUÍ ESTÁ LA CLAVE ---
      // Enviamos el ID del método para que Vita sepa cuál usar directamente
      payment_method: method_id,

      // Esparcimos los datos del pagador (nombre, email) en el nivel raíz o donde Vita lo requiera.
      // Nota: Algunas APIs piden esto dentro de un objeto 'payer'.
      // Basado en la estructura plana de 'required_fields', probamos enviarlos en la raíz primero.
      ...payer_details
    };

    console.log('💰 Payload Pago Directo enviado a Vita:', payload);

    const paymentOrderResponse = await createPaymentOrder(payload);

    res.status(201).json({ ok: true, data: paymentOrderResponse });

  } catch (e) {
    console.error('❌ Error en pago directo:', e);
    // Mejoramos el error para ver si Vita se queja de algún campo extra
    if (e.response) {
      console.error('Detalle error Vita:', e.response.data);
      return res.status(e.response.status).json({ ok: false, error: 'Error de Vita Wallet', details: e.response.data });
    }
    next(e);
  }
});

export default router;