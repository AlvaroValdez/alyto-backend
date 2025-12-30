// backend/src/routes/vitaWebhook.js
import { Router } from 'express';
import crypto from 'crypto';
import Transaction from '../models/Transaction.js';
import { createWithdrawal } from '../services/vitaService.js';
import { vita } from '../config/env.js';

const router = Router();

// Middleware para validar firma HMAC de Vita
const validateVitaWebhookSignature = (req, res, next) => {
    const signature = req.headers['x-vita-signature'];
    const webhookSecret = process.env.VITA_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.error('[Vita Webhook] ❌ VITA_WEBHOOK_SECRET no configurado');
        return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    if (!signature) {
        console.error('[Vita Webhook] ❌ Firma no presente en headers');
        return res.status(401).json({ error: 'Missing signature' });
    }

    // Calcular firma esperada
    const payload = JSON.stringify(req.body);
    const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex');

    if (signature !== expectedSignature) {
        console.error('[Vita Webhook] ❌ Firma inválida');
        console.error('[Vita Webhook] Recibida:', signature);
        console.error('[Vita Webhook] Esperada:', expectedSignature);
        return res.status(401).json({ error: 'Invalid signature' });
    }

    console.log('[Vita Webhook] ✅ Firma válida');
    next();
};

// POST /api/webhooks/vita
router.post('/', validateVitaWebhookSignature, async (req, res) => {
    const event = req.body;

    console.log('[Vita Webhook] 📥 Evento recibido:', JSON.stringify(event, null, 2));

    try {
        const { type, payment_order, payment_attempt } = event;

        // Procesar solo eventos de Payment Order completados
        if (type === 'payment_order.completed' || type === 'payment_attempt.completed') {
            const paymentOrderId = payment_order?.id || payment_attempt?.payment_order_id;
            const metadata = payment_order?.metadata || payment_attempt?.metadata || {};

            console.log('[Vita Webhook] 💰 Payment Order completado:', paymentOrderId);
            console.log('[Vita Webhook] Metadata:', JSON.stringify(metadata, null, 2));

            // Buscar transacción en DB
            const transaction = await Transaction.findOne({ vitaPaymentOrderId: paymentOrderId });

            if (!transaction) {
                console.error('[Vita Webhook] ❌ Transacción no encontrada para Payment Order:', paymentOrderId);
                return res.status(404).json({ error: 'Transaction not found' });
            }

            // Verificar que no se haya procesado ya
            if (transaction.payinStatus === 'completed' && transaction.vitaWithdrawalId) {
                console.log('[Vita Webhook] ⚠️ Webhook ya procesado anteriormente');
                return res.json({ ok: true, message: 'Already processed' });
            }

            // Actualizar estado de Payin
            transaction.payinStatus = 'completed';
            transaction.payoutStatus = 'processing';
            await transaction.save();

            console.log('[Vita Webhook] ✅ Payin completado, creando Withdrawal...');

            // Extraer datos del beneficiario del metadata
            const { beneficiary, destination } = metadata;

            if (!beneficiary || !destination) {
                console.error('[Vita Webhook] ❌ Metadata incompleto:', metadata);
                transaction.payoutStatus = 'failed';
                transaction.errorMessage = 'Metadata incompleto en Payment Order';
                await transaction.save();
                return res.status(400).json({ error: 'Incomplete metadata' });
            }

            // Verificar si el destino es Manual Anchor (No ejecutar retiro automático)
            const { SUPPORTED_ORIGINS } = await import('../data/supportedOrigins.js');
            const destCountryCode = destination.country.toUpperCase();

            // Buscar si el país de destino está configurado como 'manual_anchor'
            const isManualAnchor = SUPPORTED_ORIGINS.some(o => o.code === destCountryCode && o.mode === 'manual_anchor');

            if (isManualAnchor) {
                console.log(`[Vita Webhook] 🛑 Destino ${destCountryCode} es Manual Anchor. Saltando retiro automático.`);
                transaction.payinStatus = 'completed';
                transaction.payoutStatus = 'pending_manual_payout'; // Nuevo estado para indicar acción manual requerida
                transaction.status = 'processing';
                await transaction.save();

                return res.json({
                    ok: true,
                    message: 'Payin confirmed. Payout queued for manual processing.',
                    manual: true
                });
            }

            // Crear Withdrawal (Payout)
            try {
                const withdrawalPayload = {
                    url_notify: vita.notifyUrl || 'https://google.com',
                    currency: destination.currency.toLowerCase(),
                    country: destination.country.toUpperCase(),
                    amount: Number(destination.amount),
                    order: transaction.order,
                    transactions_type: 'withdrawal',
                    wallet: vita.walletUUID,

                    beneficiary_type: beneficiary.type || 'person',
                    beneficiary_first_name: beneficiary.first_name,
                    beneficiary_last_name: beneficiary.last_name,
                    beneficiary_email: beneficiary.email,
                    beneficiary_document_type: beneficiary.document_type,
                    beneficiary_document_number: beneficiary.document_number,

                    account_type_bank: beneficiary.account_type_bank || 'savings',
                    account_bank: beneficiary.account_bank,
                    bank_code: beneficiary.bank_code,

                    purpose: transaction.purpose || 'family_support',
                    purpose_comentary: transaction.purpose_comentary || 'Remesa familiar'
                };

                console.log('[Vita Webhook] 📤 Creando Withdrawal:', JSON.stringify(withdrawalPayload, null, 2));

                const withdrawal = await createWithdrawal(withdrawalPayload);

                console.log('[Vita Webhook] ✅ Withdrawal creado:', withdrawal?.id);

                // Actualizar transacción con ID de Withdrawal
                transaction.vitaWithdrawalId = withdrawal?.id || withdrawal?.data?.id;
                transaction.payoutStatus = 'completed';
                transaction.status = 'processing'; // Estado general
                await transaction.save();

                console.log('[Vita Webhook] ✅ Transacción actualizada exitosamente');

                return res.json({
                    ok: true,
                    message: 'Withdrawal created successfully',
                    withdrawalId: transaction.vitaWithdrawalId
                });

            } catch (withdrawalError) {
                console.error('[Vita Webhook] ❌ Error creando Withdrawal:', withdrawalError);
                console.error('[Vita Webhook] Error details:', withdrawalError.response?.data || withdrawalError.message);

                // Actualizar transacción con error
                transaction.payoutStatus = 'failed';
                transaction.errorMessage = withdrawalError.response?.data?.message || withdrawalError.message;
                await transaction.save();

                return res.status(500).json({
                    error: 'Failed to create withdrawal',
                    details: withdrawalError.response?.data || withdrawalError.message
                });
            }
        }

        // Otros tipos de eventos
        else if (type === 'payment_order.failed' || type === 'payment_attempt.failed') {
            const paymentOrderId = payment_order?.id || payment_attempt?.payment_order_id;

            const transaction = await Transaction.findOne({ vitaPaymentOrderId: paymentOrderId });
            if (transaction) {
                transaction.payinStatus = 'failed';
                transaction.status = 'failed';
                await transaction.save();
                console.log('[Vita Webhook] ❌ Payment Order falló:', paymentOrderId);
            }

            return res.json({ ok: true, message: 'Payment failed processed' });
        }

        // Evento no manejado
        else {
            console.log('[Vita Webhook] ℹ️ Evento no manejado:', type);
            return res.json({ ok: true, message: 'Event not handled' });
        }

    } catch (error) {
        console.error('[Vita Webhook] ❌ Error procesando webhook:', error);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

export default router;
