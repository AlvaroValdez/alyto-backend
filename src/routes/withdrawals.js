import { Router } from 'express';
import { createWithdrawal, forceRefreshPrices } from '../services/vitaService.js';
import { vita } from '../config/env.js';
import Transaction from '../models/Transaction.js';

const router = Router();

// Límites KYC (CLP)
const KYC_LIMITS = { 1: 450000, 2: 4500000, 3: 50000000 };

function buildFinalCustomerData(req) {
  const sendFc = (process.env.VITA_SEND_FC || 'false').toLowerCase() === 'true';
  const fromBody = Object.fromEntries(
    Object.entries(req.body || {}).filter(([k, v]) => k.startsWith('fc_') && v !== undefined && `${v}`.trim() !== '')
  );
  if (!sendFc && Object.keys(fromBody).length === 0) return {};

  const fromUser = {
    fc_customer_type: req.user?.customerType,
    fc_legal_name: req.user?.name,
    fc_document_type: req.user?.documentType,
    fc_document_number: req.user?.documentNumber,
    fc_address: req.user?.address,
    fc_email: req.user?.email,
    fc_phone: req.user?.phoneNumber
  };
  const cleanedFromUser = Object.fromEntries(
    Object.entries(fromUser).filter(([_, v]) => v !== undefined && v !== null && `${v}`.trim() !== '')
  );
  return { ...cleanedFromUser, ...fromBody };
}

router.post('/', async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ ok: false, error: 'No se pudo identificar al usuario para la transacción.' });
    }

    const userId = req.user._id;
    const {
      country, currency, amount, order, purpose, purpose_comentary,
      beneficiary_type, beneficiary_first_name, beneficiary_last_name,
      beneficiary_email, beneficiary_address, beneficiary_document_type,
      beneficiary_document_number, account_type_bank, account_bank, bank_code,
      proofOfPayment, metadata
    } = req.body || {};

    if (!country || !currency || !amount) {
      return res.status(400).json({ ok: false, error: 'Faltan datos obligatorios.' });
    }

    // ⭐ VALIDACIÓN DE CUMPLIMIENTO (antes de crear transacción)
    // Inferir país de origen desde moneda (BOB→BO, CLP→CL, etc.)
    const { SUPPORTED_ORIGINS } = await import('../data/supportedOrigins.js');
    const inferredOriginCountry = SUPPORTED_ORIGINS.find(o => o.currency === String(currency).toUpperCase())?.code || 'CL';

    const { validateComplianceLimits } = await import('../services/complianceService.js');

    const complianceCheck = await validateComplianceLimits(
      userId,
      Number(amount),
      String(currency).toUpperCase(),
      inferredOriginCountry
    );

    if (!complianceCheck.valid) {
      return res.status(403).json({
        ok: false,
        error: 'Transacción bloqueada por cumplimiento',
        details: complianceCheck.reason
      });
    }

    // ✅ RESTAURADO: Construcción de datos del cliente (no modificar)
    const finalCustomerData = buildFinalCustomerData(req);

    // Flujos manuales Bolivia
    const isManualOnRamp = currency?.toUpperCase() === 'BOB'; // Usuario deposita BOB
    const isManualOffRamp = country?.toUpperCase() === 'BO'; // Pago a Bolivia
    const orderId = order || `ORD-${Date.now()}`;
    const notifyUrl = vita.notifyUrl || 'https://google.com';

    // ⚠️ Si requiere aprobación manual por compliance
    if (complianceCheck.requiresApproval) {
      console.warn(`[withdrawals] ⚠️  Transacción requiere aprobación manual: ${amount} ${currency}`);
    }

    console.log('[withdrawals] Purpose enviado:', purpose); // Debug log

    // 💰 Lógica de Retención de Profit (Fixed Destination Amount)
    let amountToSend = Number(amount);

    // Obtener configuración para verificar si profitRetention está activo
    // (Import dinámico para evitar ciclos si fuera necesario, o uso directo)
    const { default: TransactionConfig } = await import('../models/TransactionConfig.js');
    const rule = await TransactionConfig.findOne({ originCountry: inferredOriginCountry });
    console.log(`[withdrawals] Config loading for ${inferredOriginCountry}: ProfitRetention=${rule?.profitRetention}`);

    if (rule?.profitRetention && !isManualOffRamp) { // Solo para Vita automático
      if (req.body.amountsTracking?.destReceiveAmount && req.body.rateTracking?.vitaRate) {
        const targetDest = Number(req.body.amountsTracking.destReceiveAmount);
        const rate = Number(req.body.rateTracking.vitaRate);

        if (targetDest > 0 && rate > 0) {
          // Cálculo inverso: Cuánto CLP necesito para generar EXACTAMENTE targetDest COP al rate real
          const calculatedSource = targetDest / rate;

          // Safety Check: Nunca enviar MÁS de lo que pagó el cliente (margin call risk)
          // Permitimos un margen de error de 1.0 (rounding)
          if (calculatedSource <= (amountToSend + 1)) {
            // Redondear a 2 decimales para evitar problemas de precisión
            amountToSend = Number(calculatedSource.toFixed(2));
            console.log(`[withdrawals] 💰 Profit Retention Active: Enviando coste real ${amountToSend} ${currency} (en lugar de ${amount}) para entregar ${targetDest} destino.`);
          } else {
            console.warn('[withdrawals] ⚠️ Profit Retention Safety: Coste calculado > Precio venta. Enviando monto original.', { calculatedSource, amountToSend });
          }
        }
      }
    }

    const withdrawalPayload = {
      url_notify: notifyUrl,
      currency: String(currency).toLowerCase(),
      country: String(country).toUpperCase(),
      amount: amountToSend, // ✅ Usamos el monto ajustado (o el original)
      order: orderId,
      transactions_type: 'withdrawal',
      wallet: vita.walletUUID,

      beneficiary_type,
      beneficiary_first_name,
      beneficiary_last_name,
      beneficiary_email,
      beneficiary_address,
      beneficiary_document_type,
      beneficiary_document_number,
      account_type_bank,
      account_bank,
      bank_code: bank_code !== undefined ? Number(bank_code) : undefined,

      purpose,
      purpose_comentary: purpose_comentary || 'Pago servicios',

      ...finalCustomerData // fc_* (opcionales)
    };

    let vitaResponse = {};
    let transactionStatus = 'pending';
    let checkoutUrl = null;
    let vitaTxnId = null;

    if (isManualOnRamp) {
      transactionStatus = 'pending_verification';
      vitaResponse = { manual: true, message: 'Esperando verificación', id: `MANUAL-ON-${Date.now()}` };

    } else if (isManualOffRamp) {
      transactionStatus = 'pending_manual_payout';
      vitaResponse = { manual: true, id: `MANUAL-OFF-${Date.now()}` };

    } else {
      // Vita online
      console.log('[withdrawals] Enviando Payload a Vita...');
      try {
        // Puede venir como { data: {...} } o plano
        const resp = await createWithdrawal(withdrawalPayload);
        const raw = resp?.data ?? resp;

        vitaResponse = raw;
        vitaTxnId = raw?.id || raw?.data?.id || null;
        // ⭐️ Business Checkout devuelto por Vita (siempre preferente)
        checkoutUrl =
          raw?.checkout_url ||
          raw?.data?.checkout_url ||
          raw?.attributes?.checkout_url ||
          raw?.data?.attributes?.checkout_url ||
          null;

      } catch (firstError) {
        const errorData = firstError.response?.data?.error || {};
        const msg = `${errorData?.message || ''}`.toLowerCase();
        if (msg.includes('precio') || msg.includes('price') || msg.includes('caducaron')) {
          console.warn('⚠️ [withdrawals] Precios caducados. Refrescando...');
          await forceRefreshPrices();
          await new Promise(r => setTimeout(r, 1500));
          const resp2 = await createWithdrawal(withdrawalPayload);
          const raw2 = resp2?.data ?? resp2;
          vitaResponse = raw2;
          vitaTxnId = raw2?.id || raw2?.data?.id || null;
          checkoutUrl =
            raw2?.checkout_url ||
            raw2?.data?.checkout_url ||
            raw2?.attributes?.checkout_url ||
            raw2?.data?.attributes?.checkout_url ||
            null;
          console.log('✅ [withdrawals] Segundo intento exitoso.');
        } else {
          throw firstError;
        }
      }

      transactionStatus = 'processing';
    }

    // Guardar transacción (siempre)

    // 🔍 DEBUG FEE
    console.log('🔍 [withdrawals] Fee values del body:', {
      fee: req.body.fee,
      feePercent: req.body.feePercent,
      feeOriginAmount: req.body.feeOriginAmount
    });

    const newTransaction = await Transaction.create({
      order: orderId,
      country,
      currency,
      amount,
      beneficiary_type,
      beneficiary_first_name,
      beneficiary_last_name,
      beneficiary_email,
      beneficiary_address,
      beneficiary_document_type,
      beneficiary_document_number,
      status: transactionStatus,
      vitaResponse,
      withdrawalPayload,
      createdBy: userId,
      proofOfPayment: proofOfPayment || null,

      // 💰 Comisiones legacy (del body o 0 por defecto)
      fee: Number(req.body.fee || 0),
      feePercent: Number(req.body.feePercent || 0),
      feeOriginAmount: Number(req.body.feeOriginAmount || 0),

      // 📊 Spread Model Tracking (from quote)
      rateTracking: req.body.rateTracking || null,
      amountsTracking: req.body.amountsTracking || null,
      feeAudit: req.body.feeAudit || null,

      // ✅ Metadata (QR, etc)
      metadata: metadata || null
    });

    console.log('✅ [withdrawals] TX guardada con:', {
      fee: newTransaction.fee,
      feePercent: newTransaction.feePercent
    });

    // Respuesta al FE:
    return res.status(201).json({
      ok: true,
      data: {
        order: orderId,
        txId: newTransaction._id,
        vitaTxnId,
        checkoutUrl // ⭐️ si viene, el FE redirige directo
      },
      raw: vitaResponse
    });

  } catch (e) {
    console.error('❌ [withdrawals] Error Final:', e);
    if (e.stack) console.error(e.stack);

    if (e.response) {
      return res.status(e.response.status).json({
        ok: false,
        error: 'Error procesando el pago con el proveedor.',
        details: e.response.data
      });
    }
    // Mongoose validation error?
    if (e.name === 'ValidationError') {
      return res.status(400).json({ ok: false, error: 'Error de validación', details: e.message });
    }

    res.status(500).json({ ok: false, error: 'Error interno del servidor.', details: e.message });
  }
});

export default router;
