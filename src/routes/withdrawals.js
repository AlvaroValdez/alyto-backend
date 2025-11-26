// backend/src/routes/withdrawals.js
// Fuente Vita: POST /api/businesses/transactions (transaction_type=withdrawal)
// Justificación: crea retiros desde la wallet empresarial hacia cuentas bancarias.
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
  // Accedemos al usuario completo gracias al middleware 'protect'
  const user = req.user;

  if (req.user && req.user._id) {
    userId = req.user._id;
  }
  try {
    console.log('[withdrawals] req.body recibido:', JSON.stringify(req.body, null, 2));

    const {
      country,
      currency,
      amount,
      order,
      purpose,
      purpose_comentary,
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
      fc_customer_type,
      fc_legal_name,
      fc_document_type,
      fc_document_number
    } = req.body || {};

    // --- 1. VALIDACIÓN DE LÍMITES KYC ---
    const userLevel = user.kyc?.level || 1; // Nivel por defecto 1
    const currentLimit = KYC_LIMITS[userLevel] || 0;

    // Asumimos que el 'amount' viene en CLP (moneda de origen)
    if (amount > currentLimit) {
      return res.status(403).json({ 
        ok: false, 
        error: `El monto excede tu límite de Nivel ${userLevel}.`,
        details: `Tu límite actual es de $${currentLimit.toLocaleString('es-CL')} CLP. Ve a tu perfil para aumentar tu nivel.`
      });
    }

    // --- FIN VALIDACIÓN KYC ---

    // Validación contra withdrawal_rules
    const countryKey = (country || '').toLowerCase();
    console.log('[withdrawals] Ejecutando validador para país:', countryKey);

    const validation = await validateWithdrawalPayload(countryKey, req.body);
    if (!validation.ok) {
      console.warn('[withdrawals] Errores de validación:', validation.errors);
      return res.status(422).json({
        ok: false,
        error: 'Validación fallida',
        details: validation.errors
      });
    }

    // Construcción de datos del cliente final (KYC)
    const finalCustomerData = {
        fc_customer_type: 'natural',
        fc_legal_name: `${user.firstName} ${user.lastName}`.trim(),
        fc_document_type: user.documentType || 'DNI',
        fc_document_number: user.documentNumber,
        fc_address: user.address,
    };

    // Construcción del payload final para Vita
    const payload = {
      url_notify: process.env.VITA_NOTIFY_URL,
      country,
      currency,
      amount,
      order: order || `ORD-${Date.now()}`,
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
      purpose_comentary
    };

    if (fc_customer_type) payload.fc_customer_type = fc_customer_type;
    if (fc_legal_name) payload.fc_legal_name = fc_legal_name;
    if (fc_document_type) payload.fc_document_type = fc_document_type;
    if (fc_document_number) payload.fc_document_number = fc_document_number;

    console.log('[withdrawals] Payload final enviado a Vita:', JSON.stringify(payload, null, 2));

    const data = await createWithdrawal(payload);
    
    // Guardar en Mongo como transacción "pending"
    await Transaction.create({
      order: payload.order,
      country,
      currency,
      amount,
      beneficiary_type: req.body.beneficiary_type,
      beneficiary_first_name,
      beneficiary_last_name,
      company_name: req.body.company_name,
      beneficiary_email,
      status: 'pending',
      vitaResponse: data,
      createdBy: userId,
    });

    res.status(201).json({ 
      ok: true, 
      data: {
        ...data, // Mantenemos la respuesta original de Vita
        order: payload.order // Añadimos el 'order' ID
      } 
    });
  } catch (e) {
    console.error('[withdrawals] Error en POST /api/withdrawals:', e);
    
    // Manejo de errores de Axios
    if (e.isAxiosError && e.response) {
      console.error('[withdrawals] Error recibido de Vita Wallet:', e.response.data);
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