import { Router } from 'express';
import { createWithdrawal } from '../services/vitaService.js';
import { vita } from '../config/env.js';
import { validateWithdrawalPayload } from '../services/withdrawalValidator.js';
import Transaction from '../models/Transaction.js';

const router = Router();

// --- DEFINICIÓN DE LÍMITES (en CLP) ---
const KYC_LIMITS = {
  1: 450000,
  2: 4500000,
  3: 50000000
};

router.post('/', async (req, res) => { // Quitamos 'next' para manejar la respuesta aquí mismo
  let userId = null;
  const user = req.user;

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
      proofOfPayment
    } = req.body || {};

    // --- 0. VALIDACIÓN DE DATOS BÁSICOS (Anti-Crash) ---
    if (!country || !currency || !amount) {
      return res.status(400).json({ ok: false, error: 'Faltan datos obligatorios (country, currency, amount).' });
    }

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

    // --- 2. VALIDACIÓN DE REGLAS ---
    const countryKey = country.toLowerCase(); // Ya validamos que country existe
    console.log('[withdrawals] Ejecutando validador para país:', countryKey);

    // Solo validamos reglas si NO es un flujo manual puro (ej: depósito interno)
    // Para simplificar, validamos siempre por ahora, a menos que sea BO salida.
    if (countryKey !== 'bo') {
      const validation = await validateWithdrawalPayload(countryKey, req.body);
      if (!validation.ok) {
        console.warn('[withdrawals] Errores de validación:', validation.errors);
        return res.status(422).json({ ok: false, error: 'Validación fallida', details: validation.errors });
      }
    }

    // --- 3. DETERMINAR FLUJO ---
    const isManualOnRamp = currency === 'BOB';
    const isManualOffRamp = country.toUpperCase() === 'BO';
    const orderId = order || `ORD-${Date.now()}`;

    let vitaResponse = {};
    let transactionStatus = 'pending';

    if (isManualOnRamp) {
      console.log('🇧🇴 [withdrawals] On-Ramp Bolivia detectado.');
      transactionStatus = 'pending_verification';
      vitaResponse = { manual: true, message: 'Esperando verificación', id: `MANUAL-ON-${Date.now()}` };

    } else if (isManualOffRamp) {
      console.log('🇧🇴 [withdrawals] Off-Ramp Bolivia detectado.');
      transactionStatus = 'pending_manual_payout';
      vitaResponse = { manual: true, id: `MANUAL-OFF-${Date.now()}` };

    } else {
      // Flujo Estándar Vita Wallet
      const finalCustomerData = {
        fc_customer_type: 'natural',
        fc_legal_name: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.name || 'N/A',
        fc_document_type: user?.documentType || 'DNI',
        fc_document_number: user?.documentNumber || 'N/A',
        fc_address: user?.address || 'N/A',
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

      console.log('[withdrawals] Payload enviado a Vita:', JSON.stringify(payload, null, 2));
      vitaResponse = await createWithdrawal(payload);
    }

    // --- 4. GUARDAR EN BD ---
    await Transaction.create({
      order: orderId,
      country, currency, amount,
      beneficiary_type, beneficiary_first_name, beneficiary_last_name,
      company_name: req.body.company_name,
      beneficiary_email,
      status: transactionStatus,
      vitaResponse,
      createdBy: userId, // Campo obligatorio del modelo
      proofOfPayment: proofOfPayment || null
    });

    res.status(201).json({
      ok: true,
      data: { ...vitaResponse, order: orderId }
    });

  } catch (e) {
    console.error('❌ [withdrawals] Error crítico:', e);

    if (e.isAxiosError && e.response) {
      console.error('Detalle error Vita:', e.response.data);
      return res.status(e.response.status).json({
        ok: false,
        error: 'Error de Vita Wallet',
        details: e.response.data.error || e.response.data
      });
    }

    // Devolvemos JSON siempre, incluso para errores de sistema o BD
    res.status(500).json({
      ok: false,
      error: 'Error interno al procesar el retiro.',
      details: e.message
    });
  }
});

export default router;