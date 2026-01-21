import { Router } from 'express';
import { createWithdrawal, forceRefreshPrices, getWalletBalance } from '../services/vitaService.js';
import { createWidgetLink } from '../services/fintocService.js';
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

    const isManualOnRamp = currency?.toUpperCase() === 'BOB';
    const isManualOffRamp = country?.toUpperCase() === 'BO';
    const orderId = order || `ORD-${Date.now()}`;
    const notifyUrl = vita.notifyUrl || 'https://google.com';

    if (complianceCheck.requiresApproval) {
      console.warn(`[withdrawals] ⚠️  Transacción requiere aprobación manual: ${amount} ${currency}`);
    }

    console.log('[withdrawals] Purpose enviado:', purpose);

    // 💰 Verificar configuración de Profit Retention
    const { default: TransactionConfig } = await import('../models/TransactionConfig.js');
    const rule = await TransactionConfig.findOne({ originCountry: inferredOriginCountry });
    console.log(`[withdrawals] Config for ${inferredOriginCountry}: ProfitRetention=${rule?.profitRetention}`);

    // Variables de control
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
      // 🔄 FLUJO HÍBRIDO: Fintoc Pay-in + Vita Pre-fondeado Payout
      if (rule?.profitRetention) {
        // ✅ HYBRID FLOW: Fintoc Direct Payment (Payin) + Deferred Withdrawal (Payout)
        console.log('[withdrawals] 💰 Hybrid Flow: Creating Fintoc Widget Link for profit retention...');

        // Calcular monto ajustado para withdrawal (usando tasa Vita real)
        let adjustedWithdrawalAmount = Number(amount);

        if (req.body.amountsTracking?.destReceiveAmount && req.body.rateTracking?.vitaRate) {
          const targetDest = Number(req.body.amountsTracking.destReceiveAmount);
          const vitaRate = Number(req.body.rateTracking.vitaRate);

          if (targetDest > 0 && vitaRate > 0) {
            // Cálculo inverso: CLP necesarios = destino_prometido / tasa_vita_real
            const calculatedSource = Number((targetDest / vitaRate).toFixed(2));

            // Safety check
            if (calculatedSource <= (Number(amount) + 1)) {
              adjustedWithdrawalAmount = calculatedSource;
              const profit = Number(amount) - adjustedWithdrawalAmount;
              console.log(`[withdrawals] 💰 Profit calculation: Client pays ${amount}, we send ${adjustedWithdrawalAmount}, profit: ${profit} ${currency}`);
            } else {
              console.warn('[withdrawals] ⚠️ Calculated cost > client payment. Using original amount.');
            }
          }
        }

        // 💰 PASO 0: VALIDACIÓN DE TESORERÍA (OPCIONAL)
        // Solo validar si está habilitado en .env
        const enableTreasuryValidation = (process.env.ENABLE_TREASURY_VALIDATION || 'false').toLowerCase() === 'true';

        if (enableTreasuryValidation) {
          console.log('[withdrawals] 💰 Verificando saldo en Vita Wallet...');
          try {
            const walletBalances = await getWalletBalance();
            const clpBalance = walletBalances.find(b => b.currency === 'CLP');
            const availableBalance = clpBalance?.available || 0;
            const requiredAmount = adjustedWithdrawalAmount || amount;

            console.log(`[withdrawals] 💰 Saldo disponible: ${availableBalance} CLP, Requerido: ${requiredAmount} CLP`);

            if (availableBalance < requiredAmount) {
              console.warn(`⚠️ [withdrawals] SALDO INSUFICIENTE: ${availableBalance} < ${requiredAmount}`);

              // Crear transacción en estado "Treasury Hold"
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
                status: 'pending_treasury_hold',
                payinStatus: 'not_started',
                payoutStatus: 'blocked_insufficient_funds',
                treasuryHold: {
                  reason: 'insufficient_vita_balance',
                  requiredAmount,
                  availableBalance,
                  blockedAt: new Date()
                },
                deferredWithdrawalPayload: null,
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

              return res.status(402).json({
                ok: false,
                error: 'Fondos insuficientes en tesorería para procesar el payout',
                code: 'INSUFFICIENT_TREASURY_FUNDS',
                details: {
                  required: requiredAmount,
                  available: availableBalance,
                  deficit: requiredAmount - availableBalance,
                  txId: newTransaction._id,
                  message: 'La transacción quedó en espera. Será procesada cuando se recargue el saldo.'
                }
              });
            }
          } catch (balanceError) {
            console.error('[withdrawals] ⚠️ Error consultando saldo, continuando sin validación:', balanceError.message);
            // Continuar sin bloquear la transacción
          }
        } else {
          console.log('[withdrawals] ⚠️ Treasury validation DISABLED. Proceeding without balance check.');
          console.log('[withdrawals] 💡 Enable with ENABLE_TREASURY_VALIDATION=true in .env');
        }

        try {
          // PASO 1: Crear Fintoc Checkout Session
          const frontendUrl = process.env.FRONTEND_URL || 'https://avf-vita-fe10.onrender.com';
          const successRedirectUrl = `${frontendUrl}/payment-success/${orderId}`; // SIN # (usa BrowserRouter)
          const cancelRedirectUrl = `${frontendUrl}/payment-cancelled/${orderId}`;

          const fintocWidgetPayload = {
            amount: Math.round(Number(amount)), // Cliente paga el monto completo
            currency: 'CLP',
            customer_email: beneficiary_email || 'cliente@example.com', // Email del cliente
            metadata: {
              orderId,
              userId: userId.toString(),
              beneficiaryName: `${beneficiary_first_name} ${beneficiary_last_name}`,
              country,
              destCurrency: currency
            },
            success_url: successRedirectUrl,
            cancel_url: cancelRedirectUrl
          };

          const fintocResp = await createWidgetLink(fintocWidgetPayload);

          vitaResponse = { fintoc: true, ...fintocResp };
          const fintocPaymentIntentId = fintocResp?.id || null;
          checkoutUrl = fintocResp?.url || null;  // Fintoc devuelve 'url', no 'widget_url'

          // PASO 2: Preparar Withdrawal diferido (se ejecutará vía IPN)
          // 🔧 FIX: Asegurar que beneficiary_address NO esté vacío
          const safeAddress = beneficiary_address || req.body.beneficiary?.address || 'N/A';

          deferredWithdrawalPayload = {
            url_notify: notifyUrl,
            currency: String(currency).toLowerCase(),
            country: String(country).toUpperCase(),
            amount: adjustedWithdrawalAmount, // ⭐ MONTO AJUSTADO (profit retenido)
            order: orderId,
            transactions_type: 'withdrawal',
            wallet: vita.walletUUID,
            beneficiary_type,
            beneficiary_first_name,
            beneficiary_last_name,
            beneficiary_email,
            beneficiary_address: safeAddress, // 🔧 Usar fallback si está vacío
            beneficiary_document_type,
            beneficiary_document_number,
            account_type_bank,
            account_bank,
            bank_code: bank_code !== undefined ? Number(bank_code) : undefined,
            purpose,
            purpose_comentary: purpose_comentary || 'Pago servicios',
            ...finalCustomerData
          };

          payinStatus = 'pending';
          payoutStatus = 'pending';
          transactionStatus = 'pending';

          console.log(`✅ [withdrawals] Fintoc Widget Link created: ${fintocPaymentIntentId}. Withdrawal deferred (adjusted amount: ${adjustedWithdrawalAmount}).`);
          console.log(`✅ [withdrawals] Widget URL: ${checkoutUrl}`);

          // Guardar ID de Fintoc en lugar de Payment Order
          vitaPaymentOrderId = null; // Ya no usamos Payment Orders de Vita
          vitaTxnId = fintocPaymentIntentId; // Usamos el ID de Fintoc

        } catch (error) {
          console.error('❌ [withdrawals] Error creating Fintoc Widget Link:', error.message);
          if (error.response) {
            console.error('[withdrawals] Fintoc Error Response:', error.response.data);
          }
          throw error;
        }

      } else {
        // ❌ LEGACY: Direct Withdrawal (one-step, sin profit retention)
        console.log('[withdrawals] 📦 Legacy Flow: Direct Withdrawal (no profit retention)...');

        const withdrawalPayload = {
          url_notify: notifyUrl,
          currency: String(currency).toLowerCase(),
          country: String(country).toUpperCase(),
          amount: Number(amount),
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
          ...finalCustomerData
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
      withdrawalPayload: deferredWithdrawalPayload || { amount: Number(amount) },
      vitaPaymentOrderId: null, // Ya no usamos Payment Orders de Vita
      fintocPaymentIntentId: vitaTxnId, // NUEVO: ID de Fintoc
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

    console.log('✅ [withdrawals] Transaction saved:', newTransaction._id);

    return res.status(201).json({
      ok: true,
      data: {
        order: orderId,
        txId: newTransaction._id,
        fintocPaymentIntentId: vitaTxnId, // ID de Fintoc
        checkoutUrl // URL del widget de Fintoc
      },
      raw: vitaResponse
    });

  } catch (e) {
    console.error('❌ [withdrawals] Error Final:', e);

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
