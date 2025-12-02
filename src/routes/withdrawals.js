import { Router } from 'express';
import { createWithdrawal } from '../services/vitaService.js';
import { vita } from '../config/env.js';
import { validateWithdrawalPayload } from '../services/withdrawalValidator.js';
import Transaction from '../models/Transaction.js';

const router = Router();

// --- DEFINICIÓN DE LÍMITES (en CLP) ---
const KYC_LIMITS = {
  1: 450000,   // ~500 USD
  2: 4500000,  // ~5,000 USD
  3: 50000000  // ~50,000 USD
};

router.post('/', async (req, res, next) => {
  let userId = null;
  const user = req.user; // Usuario autenticado

  if (user && user._id) {
    userId = user._id;
  }

  try {
    console.log('[withdrawals] req.body recibido:', JSON.stringify(req.body, null, 2));

    const {
      country, currency, amount, order, purpose, purpose_comentary,
      beneficiary_type, beneficiary_first_name, beneficiary_last_name,
      beneficiary_email, beneficiary_address, beneficiary_document_type,
      beneficiary_document_number, account_type_bank, account_bank, bank_code,
      fc_customer_type, fc_legal_name, fc_document_type, fc_document_number,
      proofOfPayment // Solo para On-Ramp Manual
    } = req.body || {};

    // --- 1. VALIDACIÓN DE LÍMITES KYC ---
    const userLevel = user?.kyc?.level || 1;
    const currentLimit = KYC_LIMITS[userLevel] || 450000;

    if (Number(amount) > currentLimit) {
      return res.status(403).json({
        ok: false,
        error: `El monto excede tu límite de Nivel ${userLevel}.`,
        details: `Tu límite actual es de $${currentLimit.toLocaleString('es-CL')} CLP. Ve a tu perfil para aumentar tu nivel.`
      });
    }

    // --- 2. VALIDACIÓN DE REGLAS (Común para todos) ---
    const countryKey = (country || '').toLowerCase();
    console.log('[withdrawals] Ejecutando validador para país:', countryKey);

    // Nota: Para BO (Bolivia Manual) quizás quieras saltar esta validación si Vita no tiene reglas para BO.
    // Por ahora la mantenemos.
    const validation = await validateWithdrawalPayload(countryKey, req.body);
    if (!validation.ok) {
      console.warn('[withdrawals] Errores de validación:', validation.errors);
      return res.status(422).json({ ok: false, error: 'Validación fallida', details: validation.errors });
    }

    // --- 3. DETERMINAR FLUJO (Vita vs Manual) ---
    const isManualOnRamp = currency === 'BOB'; // Origen Bolivia (Entrada)
    const isManualOffRamp = country.toUpperCase() === 'BO'; // Destino Bolivia (Salida)
    const orderId = order || `ORD-${Date.now()}`;

    let vitaResponse = {};
    let transactionStatus = 'pending';

    if (isManualOnRamp) {
      // --- CASO A: On-Ramp Manual (Bolivia -> Mundo) ---
      console.log('🇧🇴 [withdrawals] On-Ramp Bolivia detectado.');
      transactionStatus = 'pending_verification';
      vitaResponse = {
        manual: true,
        message: 'Esperando verificación de depósito',
        id: `MANUAL-ON-${Date.now()}`
      };

    } else if (isManualOffRamp) {
      // --- CASO B: Off-Ramp Manual (Mundo -> Bolivia) ---
      console.log('🇧🇴 [withdrawals] Off-Ramp Bolivia detectado.');
      transactionStatus = 'pending_manual_payout';
      vitaResponse = {
        manual: true,
        id: `MANUAL-OFF-${Date.now()}`
      };

      // NOTA: Aquí normalmente el frontend procederá a pedir el Pay-in a Vita Wallet 
      // (para cobrar los CLP/USD) aunque el Payout sea manual.

    } else {
      // --- CASO C: Flujo Estándar Vita Wallet ---

      // Construcción del payload para Vita
      const finalCustomerData = {
        fc_customer_type: 'natural',
        fc_legal_name: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.name || 'N/A',
        fc_document_type: user?.documentType || 'DNI',
        fc_document_number: user?.documentNumber || 'N/A',
        fc_address: user?.address || 'N/A',
      };

      if (fc_customer_type) finalCustomerData.fc_customer_type = fc_customer_type;
      // ... mapear otros fc_ si vienen del body ...

      const payload = {
        url_notify: process.env.VITA_NOTIFY_URL,
        country, currency, amount,
        order: orderId,
        transactions_type: 'withdrawal',
        wallet: vita.walletUUID,
        beneficiary_type, beneficiary_first_name, beneficiary_last_name,
        beneficiary_email, beneficiary_address, beneficiary_document_type,
        beneficiary_document_number, account_type_bank, account_bank, bank_code,
        purpose, purpose_comentary,
        ...finalCustomerData
      };

      console.log('[withdrawals] Payload enviado a Vita:', JSON.stringify(payload, null, 2));

      // Llamada real a la API
      vitaResponse = await createWithdrawal(payload);
    }

    // --- 4. GUARDAR EN BASE DE DATOS (Unificado) ---
    await Transaction.create({
      order: orderId,
      country,
      currency,
      amount,
      beneficiary_type,
      beneficiary_first_name,
      beneficiary_last_name,
      company_name: req.body.company_name,
      beneficiary_email,
      status: transactionStatus, // pending, pending_verification o pending_manual_payout
      vitaResponse: vitaResponse,
      createdBy: userId,
      proofOfPayment: proofOfPayment || null
    });

    // --- 5. RESPUESTA AL FRONTEND ---
    res.status(201).json({
      ok: true,
      data: {
        ...vitaResponse,
        order: orderId // Importante para el siguiente paso (Pay-in)
      }
    });

  } catch (e) {
    console.error('[withdrawals] Error:', e);
    if (e.isAxiosError && e.response) {
      console.error('[withdrawals] Error Vita:', e.response.data);
      return res.status(e.response.status).json({
        ok: false,
        error: 'Error de validación de Vita Wallet',
        details: e.response.data.error || 'No se proporcionaron detalles.'
      });
    }
    next(e);
  }
});

export default router;