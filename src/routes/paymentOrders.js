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
    next(e);
  }
});

export default router;