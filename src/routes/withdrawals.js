import { Router } from 'express';
import { createWithdrawal, createPaymentOrder, forceRefreshPrices } from '../services/vitaService.js';
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

    // ⭐ VALIDACIÓN DE CUMPLIMIENTO
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

    const finalCustomerData = buildFinalCustomerData(req);

    // Flujos manuales Bolivia
    const isManualOnRamp = currency?.toUpperCase() === 'BOB';
    const isManualOffRamp = country?.toUpperCase() === 'BO';
    const orderId = order || `ORD-${Date.now()}`;
    const notifyUrl = vita.notifyUrl || 'https://google.com';

    if (complianceCheck.requiresApproval) {
      console.warn(`[withdrawals] ⚠️  Transacción requiere aprobación manual: ${amount} ${currency}`);
    }

    console.log('[withdrawals] Purpose enviado:', purpose);

    // 💰 Verificar Profit Retention Mode
    const { default: TransactionConfig } = await import('../models/TransactionConfig.js');
    const rule = await TransactionConfig.findOne({ originCountry: inferredOriginCountry });
    console.log(`[withdrawals] Config for ${inferredOriginCountry}: ProfitRetention=${rule?.profitRetention}`);

    // Calcular monto ajustado para withdrawal (si aplica)
    let adjustedWithdrawalAmount = Number(amount);
    if (rule?.profitRetention && !isManualOffRamp) {
      if (req.body.amountsTracking?.destReceiveAmount && req.body.rateTracking?.vitaRate) {
        const targetDest = Number(req.body.amountsTracking.destReceiveAmount);
        const rate = Number(req.body.rateTracking.vitaRate);

        if (targetDest > 0 && rate > 0) {
          const calculatedSource = Number((targetDest / rate).toFixed(2));

          if (calculatedSource <= (Number(amount) + 1)) {
            adjustedWithdrawalAmount = calculatedSource;
            console.log(`[withdrawals] 💰 Adjusted amount: ${adjustedWithdrawalAmount} (client pays: ${amount}, profit: ${Number(amount) - adjustedWithdrawalAmount})`);
          } else {
            console.warn('[withdrawals] ⚠️ Calculated cost > Price. Using original.');
          }
        }
      }
    }

    // 🏗️ Construir payloads base (SOLO campos que Vita acepta)
    const baseVitaFields = {
      url_notify: notifyUrl,
      currency: String(currency).toLowerCase(),
      country: String(country).toUpperCase(),
      order: orderId,
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
      ...finalCustomerData
    };

    let vitaResponse = {};
    let transactionStatus = 'pending';
    let checkoutUrl = null;
    let vitaTxnId = null;
    let vitaPaymentOrderId = null;
    let vitaWithdrawalId = null;
    let payinStatus = 'pending';
    let payoutStatus = 'pending';
    let deferredWithdrawalPayload = null;

    if (isManualOnRamp) {
      transactionStatus = 'pending_verification';
      vitaResponse = { manual: true, message: 'Esperando verificación', id: `MANUAL-ON-${Date.now()}` };

    } else if (isManualOffRamp) {
      transactionStatus = 'pending_manual_payout';
      vitaResponse = { manual: true, id: `MANUAL-OFF-${Date.now()}` };

    } else {
      // 🔄 FLUJO BIFURCADO: Two-Step vs Legacy
      if (rule?.profitRetention) {
        // ✅ TWO-STEP: Payment Order + Deferred Withdrawal
        console.log('[withdrawals] 💰 Two-Step Flow: Creating Payment Order (client pays full amount)...');

        try {
          // Payment Order payload (SOLO campos mínimos - NO incluir datos de cuenta bancaria)
          const paymentOrderPayload = {
            url_notify: notifyUrl,
            currency: String(currency).toLowerCase(),
            country: String(country).toUpperCase(),
            amount: Number(amount), // Cliente paga monto COMPLETO (con spread)
            order: orderId,
            wallet: vita.walletUUID,
            purpose,
            purpose_comentary: purpose_comentary || 'Pago servicios'
            // ❌ NO enviar: beneficiary_*, account_*, bank_code (son para withdrawal)
          };

          const poResp = await createPaymentOrder(paymentOrderPayload);
          const poData = poResp?.data ?? poResp;

          vitaResponse = poData;
          vitaPaymentOrderId = poData?.id || poData?.uid || null;
          checkoutUrl = poData?.checkout_url || poData?.data?.checkout_url || poData?.attributes?.checkout_url || null;

          // Preparar withdrawal diferido (se ejecutará en IPN post-pago)
          deferredWithdrawalPayload = {
            ...baseVitaFields,
            amount: adjustedWithdrawalAmount, // ⭐ Monto ajustado (profit retenido)
            transactions_type: 'withdrawal'
          };

          payinStatus = 'pending';
          payoutStatus = 'pending';
          transactionStatus = 'pending';

          console.log(`✅ [withdrawals] Payment Order created: ${vitaPaymentOrderId}. Withdrawal will execute post-IPN (amount: ${adjustedWithdrawalAmount}).`);

        } catch (firstError) {
          const errorData = firstError.response?.data?.error || {};
          const msg = `${errorData?.message || ''}`.toLowerCase();
          if (msg.includes('precio') || msg.includes('price') || msg.includes('caducaron')) {
            console.warn('⚠️ [withdrawals] Prices expired. Refreshing...');
            await forceRefreshPrices();

            const paymentOrderPayload2 = {
              url_notify: notifyUrl,
              currency: String(currency).toLowerCase(),
              country: String(country).toUpperCase(),
              amount: Number(amount),
              order: orderId,
              wallet: vita.walletUUID,
              purpose,
              purpose_comentary: purpose_comentary || 'Pago servicios'
            };

            const poResp2 = await createPaymentOrder(paymentOrderPayload2);
            const poData2 = poResp2?.data ?? poResp2;
            vitaResponse = poData2;
            vitaPaymentOrderId = poData2?.id || poData2?.uid || null;
            checkoutUrl = poData2?.checkout_url || poData2?.data?.checkout_url || null;
            deferredWithdrawalPayload = { ...baseVitaFields, amount: adjustedWithdrawalAmount, transactions_type: 'withdrawal' };
            console.log('✅ [withdrawals] Retry successful.');
          } else {
            throw firstError;
          }
        }

      } else {
        // ❌ LEGACY: Direct Withdrawal (one-step, sin profit retention)
        console.log('[withdrawals] 📦 Legacy Flow: Direct Withdrawal...');

        const withdrawalPayload = {
          ...baseVitaFields,
          amount: Number(amount),
          transactions_type: 'withdrawal'
        };

        try {
          const resp = await createWithdrawal(withdrawalPayload);
          const raw = resp?.data ?? resp;

          vitaResponse = raw;
          vitaTxnId = raw?.id || raw?.data?.id || null;
          vitaWithdrawalId = vitaTxnId;
          checkoutUrl =
            raw?.checkout_url ||
            raw?.data?.checkout_url ||
            raw?.attributes?.checkout_url ||
            raw?.data?.attributes?.checkout_url ||
            null;

          payinStatus = 'completed';
          payoutStatus = 'processing';
          transactionStatus = 'processing';

        } catch (firstError) {
          const errorData = firstError.response?.data?.error || {};
          const msg = `${errorData?.message || ''}`.toLowerCase();
          if (msg.includes('precio') || msg.includes('price') || msg.includes('caducaron')) {
            console.warn('⚠️ [withdrawals] Prices expired. Refreshing...');
            await forceRefreshPrices();
            await new Promise(r => setTimeout(r, 1500));
            const resp2 = await createWithdrawal(withdrawalPayload);
            const raw2 = resp2?.data ?? resp2;
            vitaResponse = raw2;
            vitaTxnId = raw2?.id || raw2?.data?.id || null;
            vitaWithdrawalId = vitaTxnId;
            checkoutUrl =
              raw2?.checkout_url ||
              raw2?.data?.checkout_url ||
              raw2?.attributes?.checkout_url ||
              raw2?.data?.attributes?.checkout_url ||
              null;
            console.log('✅ [withdrawals] Retry successful.');
          } else {
            throw firstError;
          }
        }
      }
    }

    // Guardar transacción
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
      withdrawalPayload: deferredWithdrawalPayload || { ...baseVitaFields, amount: Number(amount), transactions_type: 'withdrawal' },
      vitaPaymentOrderId,
      vitaWithdrawalId,
      payinStatus,
      payoutStatus,
      deferredWithdrawalPayload,
      createdBy: userId,
      proofOfPayment: proofOfPayment || null,
      fee: Number(req.body.fee || 0),
      feePercent: Number(req.body.feePercent || 0),
      feeOriginAmount: Number(req.body.feeOriginAmount || 0),
      rateTracking: req.body.rateTracking || null,
      amountsTracking: req.body.amountsTracking || null,
      feeAudit: req.body.feeAudit || null,
      metadata: metadata || null
    });

    console.log('✅ [withdrawals] TX saved:', {
      id: newTransaction._id,
      paymentOrderId: vitaPaymentOrderId,
      withdrawalId: vitaWithdrawalId,
      payinStatus,
      payoutStatus
    });

    return res.status(201).json({
      ok: true,
      data: {
        order: orderId,
        txId: newTransaction._id,
        vitaTxnId: vitaPaymentOrderId || vitaTxnId,
        checkoutUrl
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
    if (e.name === 'ValidationError') {
      return res.status(400).json({ ok: false, error: 'Error de validación', details: e.message });
    }

    res.status(500).json({ ok: false, error: 'Error interno del servidor.', details: e.message });
  }
});

export default router;
