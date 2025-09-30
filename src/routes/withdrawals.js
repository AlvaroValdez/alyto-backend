// backend/src/routes/withdrawals.js
// Fuente Vita: POST /api/businesses/transactions (transaction_type=withdrawal)
// Justificación: crea retiros desde la wallet empresarial hacia cuentas bancarias.

const router = require('express').Router();
const { createWithdrawal } = require('../services/vitaService');
const { vita } = require('../config/env');
const { validateWithdrawalPayload } = require('../services/withdrawalValidator');
const Transaction = require('../models/Transaction');

router.post('/', async (req, res, next) => {
  try {
    console.log('[withdrawals] req.body recibido:', JSON.stringify(req.body, null, 2));

    const {
      country,
      currency,
      amount,
      order,
      purpose,
      purpose_comentary,
      beneficiary_type,                // ⚡ ahora lo desestructuramos
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

    // ✅ Validación contra withdrawal_rules
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

    // ✅ Construcción del payload final
    const payload = {
      url_notify: process.env.VITA_NOTIFY_URL || 'http://localhost:5000/api/ipn/vita',
      //    url_notify: '/api/ipn/vita',
      country,
      currency,
      amount,
      order: order || `ORD-${Date.now()}`,
      transactions_type: 'withdrawal',
      wallet: vita.walletUUID,
      beneficiary_type,                // ⚡ ahora sí se incluye
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

    // ⚡ Agregar fc_* si existen
    if (fc_customer_type) payload.fc_customer_type = fc_customer_type;
    if (fc_legal_name) payload.fc_legal_name = fc_legal_name;
    if (fc_document_type) payload.fc_document_type = fc_document_type;
    if (fc_document_number) payload.fc_document_number = fc_document_number;

    // 🔎 Log clave para debugging
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
    });

    res.status(201).json({ ok: true, data });
  } catch (e) {
    console.error('[withdrawals] Error en POST /api/withdrawals:', e);
    next(e);
  }
});

module.exports = router;