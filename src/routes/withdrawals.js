import { Router } from 'express';
import { createWithdrawal, forceRefreshPrices, getWalletBalance } from '../services/vitaService.js';
import { createWidgetLink } from '../services/fintocService.js';
import { vita } from '../config/env.js';
import Transaction from '../models/Transaction.js';
import { transactionLimiter } from '../middleware/rateLimiters.js';
import {
  notifyComplianceLimitReached,
  notifyComplianceApprovalRequiredToAdmin,
  notifyComplianceRejectToAdmin,
  notifyAdminNewManualDeposit,
  notifyOrderCreated, // U1
  notifyAdminNewTransaction // A1.5
} from '../services/notificationService.js';

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

router.post('/', transactionLimiter, async (req, res) => {
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
      bank_name, account_type_name, // ✅ FIX: Nombres legibles de banco y tipo de cuenta
      proofOfPayment, metadata
    } = req.body || {};

    if (!country || !currency || !amount) {
      return res.status(400).json({ ok: false, error: 'Faltan datos obligatorios.' });
    }

    // ⭐ GATE de KYC — El usuario debe estar aprobado por el admin antes de poder transaccionar
    // req.user viene del middleware de autenticación (JWT), que carga el usuario de BD.
    const kycStatus = req.user?.kyc?.status;
    if (kycStatus !== 'approved') {
      const kycMessages = {
        unverified: 'Tu identidad aún no ha sido verificada. Por favor completa tu perfil y sube los documentos requeridos.',
        pending: 'Tu solicitud de verificación está en revisión. Te notificaremos cuando esté aprobada.',
        review: 'Tu documentación está siendo revisada por nuestro equipo. Te contactaremos pronto.',
        rejected: `Tu verificación fue rechazada. Motivo: ${req.user?.kyc?.rejectionReason || 'Ver notificación enviada.'}`,
      };
      const message = kycMessages[kycStatus] || 'Tu cuenta no está verificada para realizar transacciones.';
      console.warn(`[withdrawals] ❌ KYC GATE: userId=${userId} status=${kycStatus} — transacción bloqueada`);
      return res.status(403).json({
        ok: false,
        error: message,
        code: 'KYC_NOT_APPROVED',
        kycStatus: kycStatus || 'unverified'
      });
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
      // 🔔 U13 — Notificar usuario: límite alcanzado
      notifyComplianceLimitReached(userId, amount, currency).catch(() => { });
      // 🔔 A8 — Notificar admins: transacción bloqueada por compliance
      notifyComplianceRejectToAdmin(req.user?.email || 'Desconocido', amount, currency, complianceCheck.reason).catch(() => { });

      return res.status(403).json({
        ok: false,
        error: 'Transacción bloqueada por cumplimiento',
        details: complianceCheck.reason
      });
    }

    const finalCustomerData = buildFinalCustomerData(req);

    // 🔧 FLOW DETECTION
    // - Manual On-Ramp: Origen es Bolivia (BOB currency) → depósito manual
    // - Manual Off-Ramp: Destino es Bolivia (origen NO Chile) → payout manual 
    // - HYBRID CL→BO: Fintoc payin + Manual payout (Bolivia NO soportado por Vita API)
    // - HYBRID Automático: Fintoc payin + Vita payout (resto de países)
    const isManualOnRamp = currency?.toUpperCase() === 'BOB';
    const isManualOffRamp = country?.toUpperCase() === 'BO' && currency?.toUpperCase() !== 'CLP';
    const isHybridFintocManual = currency?.toUpperCase() === 'CLP' && country?.toUpperCase() === 'BO'; // ✅ CL→BO

    const orderId = order || `ORD-${Date.now()}`;
    const notifyUrl = vita.notifyUrl || 'https://google.com';

    if (complianceCheck.requiresApproval) {
      console.warn(`[withdrawals] ⚠️  Transacción requiere aprobación manual: ${amount} ${currency}`);
    }

    console.log('[withdrawals] Purpose enviado:', purpose);
    console.log(`[withdrawals] Flow Detection:`);
    console.log(`   isManualOnRamp: ${isManualOnRamp}`);
    console.log(`   isManualOffRamp: ${isManualOffRamp}`);
    console.log(`   isHybridFintocManual (CL→BO): ${isHybridFintocManual}`);
    console.log(`   currency: ${currency}, country: ${country}`);

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
      console.log('[withdrawals] 📝 Flow: MANUAL ON-RAMP (BOB origin)');
      transactionStatus = 'pending_verification';
      vitaResponse = { manual: true, message: 'Esperando verificación', id: `MANUAL-ON-${Date.now()}` };

    } else if (isManualOffRamp) {
      console.log('[withdrawals] 📝 Flow: MANUAL OFF-RAMP (BO destination, non-CLP origin)');
      transactionStatus = 'pending_manual_payout';
      vitaResponse = { manual: true, id: `MANUAL-OFF-${Date.now()}` };

    } else if (isHybridFintocManual) {
      // 💳🔧 HYBRID CL→BO: Fintoc Payin + MANUAL Payout
      // Bolivia NO soportado por Vita API, admin procesa el payout manualmente
      console.log('[withdrawals] 💳🔧 Flow: HYBRID CL→BO (Fintoc Payin + MANUAL Payout)');

      try {
        const frontendUrl = process.env.FRONTEND_URL || 'https://avf-vita-fe10.onrender.com';
        const successRedirectUrl = `${frontendUrl}/payment-success/${orderId}`;
        const cancelRedirectUrl = `${frontendUrl}/payment-cancelled/${orderId}`;

        const fintocWidgetPayload = {
          amount: Math.round(Number(amount)),
          currency: 'CLP',
          customer_email: beneficiary_email || 'cliente@example.com',
          metadata: {
            orderId,
            userId: userId.toString(),
            beneficiaryName: `${beneficiary_first_name} ${beneficiary_last_name}`,
            country: 'BO',
            destCurrency: 'BOB',
            note: 'Payout manual - Bolivia no soportado por Vita'
          },
          success_url: successRedirectUrl,
          cancel_url: cancelRedirectUrl
        };

        console.log('[withdrawals] Creating Fintoc Widget for CL→BO...');
        const fintocResp = await createWidgetLink(fintocWidgetPayload);

        vitaResponse = { fintoc: true, manualPayout: true, ...fintocResp };
        vitaTxnId = fintocResp?.id || null;
        checkoutUrl = fintocResp?.url || null;

        // ⚠️ NO CREAR deferredWithdrawalPayload - el payout es MANUAL
        deferredWithdrawalPayload = null;

        payinStatus = 'pending';
        payoutStatus = 'pending_manual_payout'; // ✅ Admin procesará desde panel
        transactionStatus = 'pending';

        console.log(`✅ [withdrawals] Fintoc Widget created for CL→BO: ${vitaTxnId}`);
        console.log(`✅ [withdrawals] Checkout URL: ${checkoutUrl}`);
        console.log(`⚠️  [withdrawals] Payout MANUAL - Admin debe procesar payout desde panel de transacciones`);

      } catch (error) {
        console.error('❌ [withdrawals] Error creating Fintoc Widget for CL→BO:', error.message);
        throw error;
      }

    } else {
      // 🔄 FLUJO HÍBRIDO AUTOMÁTICO: Fintoc Pay-in + Vita Pre-fondeado Payout
      // ✅ Incluye: CL → CO, CL → PE, etc. (NO Bolivia)
      console.log('[withdrawals] 💳 Flow: HYBRID AUTOMÁTICO (Fintoc Payin + Vita Payout)');
      if (rule?.profitRetention) {
        // ✅ HYBRID FLOW: Fintoc Direct Payment (Payin) + Deferred Withdrawal (Payout)
        console.log('[withdrawals] 💰 Hybrid Flow: Creating Fintoc Widget Link for profit retention...');

        // ✅ PROFIT RETENTION: Calcular monto a retener según % configurado
        const profitRetentionPercent = rule?.profitRetentionPercent || 0;
        const originPrincipal = req.body.amountsTracking?.originPrincipal
          ? Number(req.body.amountsTracking.originPrincipal)
          : Number(amount);

        let adjustedWithdrawalAmount;
        let profitRetained = 0;

        if (profitRetentionPercent > 0) {
          // MODO: Retener Porcentaje del Principal
          profitRetained = (originPrincipal * profitRetentionPercent) / 100;
          adjustedWithdrawalAmount = originPrincipal - profitRetained;

          // Safety check: No retener más del 5% (protección)
          const maxSafeRetention = originPrincipal * 0.05;
          if (profitRetained > maxSafeRetention) {
            console.warn(`⚠️ [withdrawals] Profit retention ${profitRetentionPercent}% exceeds safe limit! Capping at 5%`);
            profitRetained = maxSafeRetention;
            adjustedWithdrawalAmount = originPrincipal - profitRetained;
          }

          console.log(`[withdrawals] 💰 Profit Retention Active: ${profitRetentionPercent}%`);
          console.log(`[withdrawals] 💰 Profit to retain: ${profitRetained.toFixed(2)} ${currency}`);
        } else {
          // MODO: Sin Retención (enviar todo el principal)
          adjustedWithdrawalAmount = originPrincipal;
          console.log(`[withdrawals] 💰 No profit retention (0%)`);
        }

        // Calcular montos para logging
        const fintocFees = Number(amount) - originPrincipal;
        const destReceiveAmount = req.body.amountsTracking?.destReceiveAmount || 0;
        const destCurrency = req.body.amountsTracking?.destCurrency || 'COP';

        // Calcular monto real que Vita enviará (usando su tasa real-time)
        const vitaRateRealTime = req.body.rateTracking?.vitaRate || 0;
        const vitaActualSend = vitaRateRealTime > 0
          ? (adjustedWithdrawalAmount * vitaRateRealTime).toFixed(2)
          : 'N/A';
        const vitaExcess = vitaRateRealTime > 0
          ? (adjustedWithdrawalAmount * vitaRateRealTime) - destReceiveAmount
          : 0;

        // Validar que la diferencia no sea mayor al 1% negativo
        if (vitaRateRealTime > 0 && destReceiveAmount > 0) {
          const diffPercent = (vitaExcess / destReceiveAmount) * 100;
          if (diffPercent < -1.0) {
            console.warn(`⚠️ [withdrawals] User will receive ${Math.abs(diffPercent).toFixed(2)}% LESS than promised!`);
            console.warn(`⚠️ [withdrawals] Consider reducing profitRetentionPercent to ${Math.max(0, profitRetentionPercent - 0.5).toFixed(1)}%`);
          }
        }

        // Obtener config de Fintoc para fees dinámicos
        const { calculateFintocFee } = await import('../utils/fintocFees.js');
        const fintocConfig = rule?.fintocConfig || { ufValue: 37500, tier: 1 };
        const { fixedFee: fintocFee, percentage: fintocFeePercent } = calculateFintocFee(req.body.amountsTracking?.grossAmount || 10000, fintocConfig);

        console.log(`
[withdrawals] 💰 Hybrid Flow Financial Breakdown:`);
        console.log(`  ├─ PAY-IN (Fintoc):`);
        console.log(`  │  - Client pays (gross):         ${req.body.amountsTracking?.grossAmount} CLP`);
        console.log(`  │  - Fintoc config:               UF=${fintocConfig.ufValue}, Tier=${fintocConfig.tier}`);
        console.log(`  │  - Fintoc fees:                 ${fintocFee} CLP (${fintocFeePercent.toFixed(2)}%)`);
        console.log(`  │  - Net to Alyto (principal):    ${originPrincipal.toFixed(2)} ${currency}`);
        console.log(`  ├─ QUOTE (What we promised):`);
        console.log(`  │  - Alyto rate (with spread):    ${req.body.rateTracking?.alytoRate || 'N/A'}`);
        console.log(`  │  - PROMISED to beneficiary:     ${destReceiveAmount.toFixed(2)} ${destCurrency}`);

        if (profitRetentionPercent > 0) {
          console.log(`  ├─ PROFIT RETENTION:`);
          console.log(`  │  - Retention % (configured):    ${profitRetentionPercent}%`);
          console.log(`  │  - Profit retained:             ${profitRetained.toFixed(2)} ${currency}`);
          console.log(`  │  - Amount to Vita:              ${adjustedWithdrawalAmount.toFixed(2)} ${currency}`);
        }

        console.log(`  ├─ PAY-OUT (Vita - Actual):`);
        console.log(`  │  - Vita sends:                   ${adjustedWithdrawalAmount.toFixed(2)} ${currency}`);
        console.log(`  │  - Vita rate (real-time):        ${vitaRateRealTime || 'N/A'}`);
        console.log(`  │  - ACTUAL Vita will send:        ${vitaActualSend} ${destCurrency}`);
        console.log(`  │  - Difference vs promised:       ${vitaExcess >= 0 ? '+' : ''}${vitaExcess.toFixed(2)} ${destCurrency}`);
        console.log(`  └─ SUMMARY:`);

        if (profitRetentionPercent > 0) {
          console.log(`     - Alyto PROFIT RETAINED:       ${profitRetained.toFixed(2)} ${currency} (${profitRetentionPercent}%) ✅`);
        }
        console.log(`     - User receives:               ${vitaActualSend} ${destCurrency}`);
        console.log(`     - Promised amount:             ${destReceiveAmount.toFixed(2)} ${destCurrency}`);

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
      // ✅ FIX: Guardar datos bancarios en raíz del documento
      account_bank,
      bank_code,
      bank_name, // "Bancolombia" (nombre legible)
      account_type: account_type_bank,
      account_type_name, // "Cuenta de Ahorros" (nombre legible)
      status: transactionStatus,
      vitaResponse,
      withdrawalPayload: deferredWithdrawalPayload || {
        // ✅ FIX: Para transacciones manuales (BOB), incluir datos completos del beneficiario
        // Esto permite que el comprobante muestre toda la información
        amount: Number(amount),
        currency: currency?.toLowerCase(),
        country,
        beneficiary_type,
        beneficiary_first_name,
        beneficiary_last_name,
        beneficiary_email,
        beneficiary_address,
        beneficiary_document_type,
        beneficiary_document_number,
        account_type_bank,
        account_bank,
        bank_code,
        bank_name,
        account_type_name,
        purpose,
        purpose_comentary
      },
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

    // 🔔 U1 — Notificar usuario: Transacción creada
    notifyOrderCreated({
      orderId,
      amount: newTransaction.amount,
      country: newTransaction.country,
      email: req.user.email,
      userId: req.user._id
    }).catch(() => { });

    // 🔔 A4 — Notificar admins: Transacción de alto riesgo (si aprueba limits pero requiere revisión manual)
    if (complianceCheck.requiresApproval) {
      notifyComplianceApprovalRequiredToAdmin(newTransaction).catch(() => { });
    }

    // 🔔 A1 — Notificar admins: Nuevo depósito manual BOB
    if (isManualOnRamp) {
      notifyAdminNewManualDeposit(newTransaction).catch(() => { });
    }

    // 🔔 A1.5 — Notificar admins: Nueva transacción general
    // Se notifica siempre independientemente del tipo de flow para que el admin esté enterado
    notifyAdminNewTransaction(newTransaction).catch(() => { });

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

    // MongoDB duplicate key (ej: order ID ya existe)
    if (e.code === 11000) {
      const field = Object.keys(e.keyPattern || {})[0] || 'order';
      return res.status(409).json({ ok: false, error: `Ya existe una transacción con ese ${field}.`, code: 'DUPLICATE_ORDER' });
    }
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
