import { Router } from 'express';
import { createPaymentOrder } from '../services/vitaService.js';

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const { amount, country, orderId } = req.body;

    if (!amount || !country || !orderId) {
      return res.status(400).json({
        ok: false,
        error: 'Faltan datos requeridos (amount, country, orderId).',
      });
    }

    // Se usa una variable de entorno para la URL de redirección
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
    console.error('❌ Error creando la orden de pago:', e);
    // --- MANEJO DE ERRORES MEJORADO ---
    // Si el error viene de Axios (de la API de Vita), extraemos los detalles
    if (e.isAxiosError && e.response) {
      console.error('Error recibido de Vita Wallet:', e.response.data);
      // Devolvemos el error específico de Vita al frontend
      return res.status(e.response.status).json({
        ok: false,
        error: 'Error de validación de Vita Wallet',
        details: e.response.data.error || 'No se proporcionaron detalles.'
      });
    }
    next(e);
  }
});

// --- NUEVA RUTA: Obtener Requisitos de Pago Directo ---
// GET /api/payment-orders/direct-requirements
router.get('/direct-requirements', (req, res) => {
  // Aquí devolveríamos la respuesta real de Vita Wallet si hubiera un endpoint de "metadata".
  // Por ahora, usamos la estructura que nos proporcionaste.
  const mockRequirements = {
    payment_methods: [
      {
        method_id: "4820",
        name: "Khipu",
        description: "Transferencia Bancaria Simplificada",
        country: "CL", // Asumimos CL para tu caso, aunque el JSON decía AR
        required_fields: [
          {
            name: "first_name",
            type: "text",
            label: "Nombre",
            required: true,
            validation: { type: "string", max_length: 100 }
          },
          {
            name: "last_name",
            type: "text",
            label: "Apellido",
            required: true,
            validation: { type: "string", max_length: 100 }
          },
          {
            name: "email",
            type: "email", // Cambiado a 'email' para mejor UX
            label: "Correo electrónico",
            required: true,
            validation: {
              type: "string",
              max_length: 255,
              pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"
            }
          }
        ]
      }
    ]
  };

  res.json({ ok: true, data: mockRequirements });
});

export default router;