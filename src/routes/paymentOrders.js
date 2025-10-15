const router = require('express').Router();
const { createPaymentOrder } = require('../services/vitaService');

/**
 * @route   POST /api/payment-orders
 * @desc    Crea una orden de pago en Vita Wallet y devuelve la URL de pago.
 * @access  Private (debería ser protegida en el futuro)
 */
router.post('/', async (req, res, next) => {
  try {
    const { amount, country, orderId } = req.body;

    // 1. Validamos que tengamos los datos mínimos necesarios desde el frontend
    if (!amount || !country || !orderId) {
      return res.status(400).json({
        ok: false,
        error: 'Faltan datos requeridos (amount, country, orderId).',
      });
    }

    // 2. Construimos el payload para la API de Vita Wallet
    const payload = {
      amount: amount, // Monto en la moneda local
      country_iso_code: country, // ej: "CO", "PE"
      issue: `Pago de remesa, orden #${orderId}`, // Descripción para Vita
      // URL a la que Vita redirigirá al usuario tras un pago exitoso
      success_redirect_url: `https://TU-FRONTEND.com/payment-success?orderId=${orderId}`,
    };

    // 3. Llamamos al servicio para crear la orden de pago
    const paymentOrderResponse = await createPaymentOrder(payload);

    // 4. Devolvemos la respuesta (que contiene la URL de pago) al frontend
    res.status(201).json({ ok: true, data: paymentOrderResponse });

  } catch (e) {
    console.error('❌ Error creando la orden de pago:', e);
    next(e);
  }
});

module.exports = router;