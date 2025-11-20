import { Router } from 'express';
import { createWithdrawal } from '../services/vitaService.js';
import { vita } from '../config/env.js';
import { validateWithdrawalPayload } from '../services/withdrawalValidator.js';
import Transaction from '../models/Transaction.js';

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    // El middleware 'protect' ya ha adjuntado el usuario autenticado a req.user
    const userId = req.user._id; 
    
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
    
    // --- CORRECCIÓN CRUCIAL: Se añade el ID del usuario autenticado ---
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
      createdBy: userId, // <-- ¡SOLUCIÓN DEL ERROR!
    });

    res.status(201).json({ 
      ok: true, 
      data: {
        ...data,
        order: payload.order
      } 
    });
  } catch (e) {
    console.error('[withdrawals] Error en POST /api/withdrawals:', e);
    
    // Manejo de errores de Axios
    if (e.isAxiosError && e.response) {
      console.error('[withdrawals] Error recibido de Vita Wallet:', e.response.data);
      return res.status(e.response.status).json({
        ok: false,
        error: 'Validación fallida de Vita Wallet',
        details: e.response.data.error || 'No se proporcionaron detalles.'
      });
    }

    next(e);
  }
});

export default router;