import { Router } from 'express';
import { createWithdrawal } from '../services/vitaService.js';
import { vita } from '../config/env.js';
import { validateWithdrawalPayload } from '../services/withdrawalValidator.js';
import Transaction from '../models/Transaction.js';

const router = Router();

// Límites KYC (CLP) - Configurable según el nivel del usuario
const KYC_LIMITS = {
  1: 450000,
  2: 4500000,
  3: 50000000
};

router.post('/', async (req, res) => {
  // 1. DEPURACIÓN Y SEGURIDAD DE USUARIO
  console.log('[withdrawals] Usuario autenticado:', req.user ? req.user._id : 'NO IDENTIFICADO');

  if (!req.user || !req.user._id) {
    return res.status(401).json({ ok: false, error: 'No se pudo identificar al usuario para la transacción.' });
  }

  const userId = req.user._id;

  try {
    console.log('[withdrawals] Body recibido:', JSON.stringify(req.body, null, 2));

    const {
      country, currency, amount, order, purpose, purpose_comentary,
      beneficiary_type, beneficiary_first_name, beneficiary_last_name,
      beneficiary_email, beneficiary_address, beneficiary_document_type,
      beneficiary_document_number, account_type_bank, account_bank, bank_code, bank_name,
      proofOfPayment, recipientQrImage
    } = req.body || {};

    // 2. VALIDACIÓN DE DATOS REQUERIDOS
    if (!country || !currency || !amount) {
      return res.status(400).json({ ok: false, error: 'Faltan datos obligatorios (country, currency, amount).' });
    }

    // 3. VALIDACIÓN DE LÍMITES KYC
    const userLevel = req.user.kyc?.level || 1;
    const currentLimit = KYC_LIMITS[userLevel] || 450000;

    if (Number(amount) > currentLimit) {
      return res.status(403).json({
        ok: false,
        error: `El monto excede tu límite de Nivel ${userLevel}.`,
        details: `Tu límite actual es de $${currentLimit.toLocaleString('es-CL')} CLP.`
      });
    }

    // 4. VALIDACIÓN DE REGLAS ESPECÍFICAS POR PAÍS (Excepto Bolivia/Manual)
    const countryKey = country.toLowerCase();
    if (countryKey !== 'bo') {
      const validation = await validateWithdrawalPayload(countryKey, req.body);
      if (!validation.ok) {
        console.warn('[withdrawals] Errores de validación:', validation.errors);
        return res.status(422).json({ ok: false, error: 'Validación fallida', details: validation.errors });
      }
    }

    // 5. DETERMINAR FLUJO (Manual On-Ramp, Off-Ramp o Vita Wallet)
    const isManualOnRamp = currency === 'BOB';
    const isManualOffRamp = country.toUpperCase() === 'BO';
    const orderId = order || `ORD-${Date.now()}`;

    let vitaResponse = {};
    let transactionStatus = 'pending';

    if (isManualOnRamp) {
      // --- On-Ramp Bolivia ---
      console.log('🇧🇴 [withdrawals] On-Ramp Bolivia detectado.');
      transactionStatus = 'pending_verification';
      vitaResponse = { manual: true, message: 'Esperando verificación', id: `MANUAL-ON-${Date.now()}` };

    } else if (isManualOffRamp) {
      // --- Off-Ramp Bolivia ---
      console.log('🇧🇴 [withdrawals] Off-Ramp Bolivia detectado.');
      transactionStatus = 'pending_manual_payout';
      vitaResponse = { manual: true, id: `MANUAL-OFF-${Date.now()}` };

    } else {
      // --- Flujo Estándar Vita Wallet ---

      // A. Definir datos del remitente (Customer)
      const finalCustomerData = {
        fc_customer_type: 'natural',
        fc_legal_name: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.name || 'N/A',
        fc_document_type: req.user.documentType || 'DNI',
        fc_document_number: req.user.documentNumber || 'N/A',
        fc_address: req.user.address || 'Ciudad',
        fc_email: req.user.email
      };

      // B. Construir Payload estricto para Vita (Sin campos extra que rompan la firma)
      const payload = {
        url_notify: process.env.VITA_NOTIFY_URL,
        country,
        currency,
        amount,
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
        bank_code,
        purpose,
        purpose_comentary,
        ...finalCustomerData
      };

      console.log('[withdrawals] Payload enviado a Vita:', JSON.stringify(payload, null, 2));
      vitaResponse = await createWithdrawal(payload);
    }

    // 6. PERSISTENCIA EN BASE DE DATOS
    console.log('[withdrawals] Guardando transacción para usuario:', userId);

    const newTransaction = await Transaction.create({
      order: orderId,
      country,
      currency,
      amount,
      beneficiary_type: req.body.beneficiary_type,
      beneficiary_first_name,
      beneficiary_last_name,
      company_name: req.body.company_name,
      beneficiary_email,
      beneficiary_document_type,
      beneficiary_document_number,
      bank_code,
      bank_name: bank_name || 'Desconocido',
      account_type_bank,
      account_bank,
      status: transactionStatus,
      vitaResponse,
      createdBy: userId,
      proofOfPayment: proofOfPayment || null,
      recipientQrImage: recipientQrImage || null
    });

    console.log('[withdrawals] Transacción guardada ID:', newTransaction._id);

    res.status(201).json({
      ok: true,
      data: { ...vitaResponse, id: newTransaction._id, order: orderId }
    });

  } catch (e) {
    console.error('❌ [withdrawals] Error:', e.message);

    // Manejo de errores de API externa (Vita Wallet)
    if (e.isAxiosError && e.response) {
      console.error('🔥 DETALLE ERROR VITA:', JSON.stringify(e.response.data, null, 2));
      return res.status(e.response.status).json({
        ok: false,
        error: 'Error de Vita Wallet',
        details: e.response.data.errors || e.response.data.message || e.response.data
      });
    }

    // Manejo de errores de validación de Mongoose
    if (e.name === 'ValidationError') {
      const messages = Object.values(e.errors).map(val => val.message);
      return res.status(400).json({ ok: false, error: 'Error de validación local', details: messages });
    }

    res.status(500).json({
      ok: false,
      error: 'Error interno al procesar la solicitud.',
      details: e.message
    });
  }
});

export default router;