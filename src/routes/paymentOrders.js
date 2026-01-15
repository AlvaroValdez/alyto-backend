import { Router } from 'express';
import { createPaymentOrder, getPaymentMethods, executeDirectPayment } from '../services/vitaService.js';
import { vita } from '../config/env.js';
import { notifyOrderCreated } from '../services/notificationService.js';
import { body } from 'express-validator';
import { validateResult } from '../middleware/validate.js';
import Transaction from '../models/Transaction.js';

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
router.post('/', [
  body('amount').isNumeric().withMessage('El monto debe ser numérico'),
  body('country').isIn(['AR', 'CL', 'CO', 'MX', 'BR', 'PE', 'US', 'ar', 'cl', 'co', 'mx', 'br', 'pe', 'us']).withMessage('País no soportado'),
  body('orderId').notEmpty().withMessage('ID de orden requerido'),
  validateResult
], async (req, res, next) => {
  try {
    const { amount, country, orderId, metadata } = req.body || {};
    if (amount === undefined || amount === null || !country || !orderId) {
      return res.status(400).json({ ok: false, error: 'Faltan datos requeridos.' });
    }

    const frontendUrl = process.env.FRONTEND_URL || req.headers.origin || 'http://localhost:5173';
    const successRedirectUrl = `${frontendUrl}/#/payment-success/${encodeURIComponent(orderId)}`;

    const SUPPORTED_COUNTRIES = ['AR', 'CL', 'CO', 'MX', 'BR'];
    let safeCountry = String(country).toUpperCase().trim();

    if (!SUPPORTED_COUNTRIES.includes(safeCountry)) {
      console.warn(`⚠️ [payment-orders] Country ${safeCountry} not supported by Vita. Falling back to CL.`);
      safeCountry = 'CL';
    }

    const payload = {
      amount: Math.round(Number(amount)),
      country_iso_code: safeCountry,
      issue: `Pago de remesa #${orderId}`,
      success_redirect_url: successRedirectUrl
      // url_notify eliminado para evitar error 422 "Invalid Signature"
    };

    // 🔍 IDEMPOTENCIA: Verificar si ya existe una Payment Order para esta transacción
    // Esto evita doble creación (withdrawals.js crea una, y frontend intenta crear otra)
    let raw;
    const existingTx = await Transaction.findOne({ order: orderId });

    if (existingTx && existingTx.vitaPaymentOrderId) {
      console.log(`[payment-orders] ♻️ Reutilizando Payment Order existente: ${existingTx.vitaPaymentOrderId}`);
      // Reconstruir respuesta desde lo guardado en BD
      raw = existingTx.vitaResponse || {};

      // Asegurar que el ID y URL estén presentes
      if (!raw.id) raw.id = existingTx.vitaPaymentOrderId;

      // Si falta la URL en vitaResponse, intentar recuperarla o advertir
      // (Nota: withdrawals.js guarda la respuesta completa de Vita, debería tener la URL)
      if (!raw.attributes?.url && !raw.url && !raw.checkout_url) {
        console.warn('[payment-orders] ⚠️ Payment Order existente no tiene URL guardada. Intentando recuperar...');
        // Opcional: Podríamos consultar a Vita status aquí si fuera crítico
      }
    } else {
      // Si no existe, crear nueva en Vita
      const response = await createPaymentOrder(payload);
      raw = response?.data ?? response;
    }

    // Log útil (sin secretos)
    console.log('[payment-orders] Vita response keys:', Object.keys(raw || {}));
    console.log('[payment-orders] Full response structure:', JSON.stringify(raw, null, 2));

    // ⭐ USAR LA URL QUE VITA DEVUELVE (attributes.url)
    // Vita devuelve una URL corta tipo: https://stage.vitawallet.io/s/XXXXX
    const checkoutUrl = raw?.attributes?.url || raw?.url || null;
    const vitaPaymentOrderId = raw?.id || raw?.data?.id || null;

    if (checkoutUrl) {
      console.log('[payment-orders] ✅ Checkout URL de Vita:', checkoutUrl);
    } else {
      console.error('[payment-orders] ❌ Vita no devolvió URL de checkout');
      console.error('[payment-orders] Response:', raw);
    }

    // 💰 PROFIT RETENTION LOGIC
    // Actualizar la transacción existente con deferredWithdrawalPayload si profit retention está activo
    try {
      const transaction = await Transaction.findOne({ order: orderId });

      if (transaction && metadata?.beneficiary && metadata?.destination) {
        console.log('[payment-orders] 🔍 Transacción encontrada. Evaluando profit retention...');

        // Verificar configuración de profit retention
        const { SUPPORTED_ORIGINS } = await import('../data/supportedOrigins.js');
        const inferredOriginCountry = SUPPORTED_ORIGINS.find(o => o.code === String(safeCountry).toUpperCase())?.code || 'CL';

        const { default: TransactionConfig } = await import('../models/TransactionConfig.js');
        const rule = await TransactionConfig.findOne({ originCountry: inferredOriginCountry });

        if (rule?.profitRetention) {
          console.log('[payment-orders] 💰 Profit Retention enabled. Preparing deferred withdrawal...');

          // Calcular monto ajustado (usando tracking data guardado en transacción)
          let adjustedAmount = transaction.amount;

          if (transaction.amountsTracking?.destReceiveAmount && transaction.rateTracking?.vitaRate) {
            const targetDest = Number(transaction.amountsTracking.destReceiveAmount);
            const vitaRate = Number(transaction.rateTracking.vitaRate);

            if (targetDest > 0 && vitaRate > 0) {
              const calculatedSource = Number((targetDest / vitaRate).toFixed(2));

              if (calculatedSource <= (Number(transaction.amount) + 1)) {
                adjustedAmount = calculatedSource;
                const profit = Number(transaction.amount) - adjustedAmount;
                console.log(`[payment-orders] 💰 Calculated profit: Client pays ${transaction.amount}, we send ${adjustedAmount}, profit: ${profit}`);
              }
            }
          }

          // Preparar payload completo para withdrawal diferido
          const deferredWithdrawalPayload = {
            url_notify: vita.notifyUrl || 'https://google.com',
            currency: String(transaction.currency).toLowerCase(),
            country: String(metadata.destination.country).toUpperCase(),
            amount: adjustedAmount, // ⭐ MONTO AJUSTADO (con profit)
            order: orderId,
            transactions_type: 'withdrawal',
            wallet: vita.walletUUID,

            // Datos del beneficiario desde metadata
            beneficiary_type: metadata.beneficiary.type,
            beneficiary_first_name: metadata.beneficiary.first_name,
            beneficiary_last_name: metadata.beneficiary.last_name,
            beneficiary_email: metadata.beneficiary.email,
            beneficiary_address: metadata.beneficiary.address || '',
            beneficiary_document_type: metadata.beneficiary.document_type,
            beneficiary_document_number: metadata.beneficiary.document_number,
            account_type_bank: metadata.beneficiary.account_type_bank,
            account_bank: metadata.beneficiary.account_bank,
            bank_code: metadata.beneficiary.bank_code ? Number(metadata.beneficiary.bank_code) : undefined,

            purpose: transaction.purpose || 'EPFAMT',
            purpose_comentary: transaction.purpose_comentary || 'Pago servicios'
          };

          // Actualizar transacción con withdrawal diferido
          transaction.vitaPaymentOrderId = vitaPaymentOrderId;
          transaction.deferredWithdrawalPayload = deferredWithdrawalPayload;
          transaction.payinStatus = 'pending';
          transaction.payoutStatus = 'pending';

          await transaction.save();

          console.log(`✅ [payment-orders] Transacción actualizada con withdrawal diferido (adjusted amount: ${adjustedAmount})`);
        } else {
          // Sin profit retention, solo guardar el vitaPaymentOrderId
          transaction.vitaPaymentOrderId = vitaPaymentOrderId;
          await transaction.save();
          console.log('[payment-orders] ✅ Transacción actualizada (sin profit retention)');
        }
      } else {
        console.warn('[payment-orders] ⚠️ No se encontró transacción o faltan datos de metadata');
      }
    } catch (dbError) {
      console.error('[payment-orders] ❌ Error actualizando transacción:', dbError);
      // No fallar la request, solo logear el error
    }

    // Notificar creación de orden
    if (req.user?.email) {
      notifyOrderCreated({
        orderId,
        amount: Math.round(Number(amount)),
        country: safeCountry,
        email: req.user.email
      }).catch(err => console.error('[Notification] Error sending order email:', err.message));
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

    // Construir payment_data: usar el objeto anidado si viene, si no usar campos planos
    const paymentDetails =
      payment_data && typeof payment_data === 'object'
        ? payment_data
        : flat;

    if (!paymentDetails || Object.keys(paymentDetails).length === 0) {
      return res.status(400).json({ ok: false, error: 'Faltan datos de pago.' });
    }

    console.log('[executeDirectPayment] vitaOrderId:', vitaOrderId);
    console.log('[executeDirectPayment] method_id:', method_id);
    console.log('[executeDirectPayment] paymentDetails:', paymentDetails);

    const response = await executeDirectPayment({
      uid: vitaOrderId,
      method_id,
      payment_data: paymentDetails, // ✅ Pasar como objeto anidado
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