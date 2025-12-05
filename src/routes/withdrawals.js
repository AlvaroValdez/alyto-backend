import { Router } from 'express';
import { createWithdrawal } from '../services/vitaService.js';
import { vita } from '../config/env.js';
import { validateWithdrawalPayload } from '../services/withdrawalValidator.js';
import Transaction from '../models/Transaction.js';

const router = Router();

// Límites KYC (CLP)
const KYC_LIMITS = {
  1: 450000,
  2: 4500000,
  3: 50000000
};

router.post('/', async (req, res) => {
  // 1. DEPURACIÓN DE USUARIO
  console.log('[withdrawals] Usuario autenticado:', req.user ? req.user._id : 'NO IDENTIFICADO');

  if (!req.user || !req.user._id) {
    // Si el middleware protect falló o no pasó el usuario, detenemos aquí.
    return res.status(401).json({ ok: false, error: 'No se pudo identificar al usuario para la transacción.' });
  }

  const userId = req.user._id;

  try {
    console.log('[withdrawals] Body recibido:', JSON.stringify(req.body, null, 2));

    const {
      country, currency, amount, order, purpose, purpose_comentary,
      beneficiary_type, beneficiary_first_name, beneficiary_last_name,
      beneficiary_email, beneficiary_address, beneficiary_document_type,
      beneficiary_document_number, account_type_bank, account_bank, bank_code,
      fc_customer_type, fc_legal_name, fc_document_type, fc_document_number,
      proofOfPayment
    } = req.body || {};

    // 2. VALIDACIÓN DE DATOS BÁSICOS
    if (!country || !currency || !amount) {
      return res.status(400).json({ ok: false, error: 'Faltan datos obligatorios (country, currency, amount).' });
    }

    // 3. VALIDACIÓN DE LÍMITES KYC
    const userLevel = req.user.kyc?.level || 1;
    const currentLimit = KYC_LIMITS[userLevel] || 450000;

    // Validación simple asumiendo monto en CLP o equivalente
    if (Number(amount) > currentLimit) {
      return res.status(403).json({
        ok: false,
        error: `El monto excede tu límite de Nivel ${userLevel}.`,
        details: `Tu límite actual es de $${currentLimit.toLocaleString('es-CL')} CLP.`
      });
    }

    // 4. VALIDACIÓN DE REGLAS (Saltar si es Anchor Manual)
    const countryKey = country.toLowerCase();
    // Si es Bolivia (Manual), saltamos la validación estricta de Vita
    if (countryKey !== 'bo') {
      const validation = await validateWithdrawalPayload(countryKey, req.body);
      if (!validation.ok) {
        console.warn('[withdrawals] Errores de validación:', validation.errors);
        return res.status(422).json({ ok: false, error: 'Validación fallida', details: validation.errors });
      }
    }

    // 5. DETERMINAR FLUJO
    const isManualOnRamp = currency === 'BOB'; // Depósito en Bolivia
    const isManualOffRamp = country.toUpperCase() === 'BO'; // Envío a Bolivia
    const orderId = order || `ORD-${Date.now()}`;

    let vitaResponse = {};
    let transactionStatus = 'pending';

    if (isManualOnRamp) {
      // --- On-Ramp (Depósito Manual) ---
      console.log('🇧🇴 [withdrawals] On-Ramp Bolivia.');
      transactionStatus = 'pending_verification';
      vitaResponse = { manual: true, message: 'Esperando verificación', id: `MANUAL-ON-${Date.now()}` };

    } else if (isManualOffRamp) {
      // --- Off-Ramp (Envío Manual) ---
      console.log('🇧🇴 [withdrawals] Off-Ramp Bolivia.');
      transactionStatus = 'pending_manual_payout';
      vitaResponse = { manual: true, id: `MANUAL-OFF-${Date.now()}` };
      // Aquí normalmente NO llamamos a Vita Withdrawal, solo creamos la orden interna
      // El Pay-in se gestionará después en el frontend

    } else {
      // --- Flujo Estándar Vita Wallet ---
      const finalCustomerData = {
        fc_customer_type: 'natural',
        fc_legal_name: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.name,
        fc_document_type: req.user.documentType || 'DNI',
        fc_document_number: req.user.documentNumber || 'N/A',
        fc_address: req.user.address || 'N/A',
      };
      if (fc_customer_type) finalCustomerData.fc_customer_type = fc_customer_type;

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

      console.log('[withdrawals] Enviando a Vita...');
      vitaResponse = await createWithdrawal(payload);
    }

    // 6. GUARDAR EN BASE DE DATOS
    console.log('[withdrawals] Guardando transacción para usuario:', userId);

    const newTransaction = await Transaction.create({
      order: orderId,
      country, currency, amount,
      beneficiary_type: req.body.beneficiary_type,
      beneficiary_first_name,
      beneficiary_last_name,
      company_name: req.body.company_name,
      beneficiary_email,
      status: transactionStatus,
      vitaResponse,
      createdBy: userId, // Campo CRÍTICO
      proofOfPayment: proofOfPayment || null
    });

    console.log('[withdrawals] Transacción guardada ID:', newTransaction._id);

    res.status(201).json({
      ok: true,
      data: { ...vitaResponse, order: orderId }
    });

  } catch (e) {
    console.error('❌ [withdrawals] Error:', e);

    // Manejo de errores de Vita (Axios)
    if (e.isAxiosError && e.response) {
      return res.status(e.response.status).json({
        ok: false,
        error: 'Error de Vita Wallet',
        details: e.response.data.error || e.response.data
      });
    }

    // Manejo de errores de Mongoose (Validación)
    if (e.name === 'ValidationError') {
      const messages = Object.values(e.errors).map(val => val.message);
      return res.status(400).json({ ok: false, error: 'Error de validación de datos', details: messages });
    }

    // Error Genérico (evita el 500 HTML)
    res.status(500).json({
      ok: false,
      error: 'Error interno al procesar la solicitud.',
      details: e.message
    });
  }
});

export default router;