// src/routes/ipnFintoc.js
import { Router } from 'express';
import { verifyFintocWebhook } from '../services/fintocService.js';
import { createWithdrawal, forceRefreshPrices } from '../services/vitaService.js';
import Transaction from '../models/Transaction.js';
import { vita } from '../config/env.js';

const router = Router();

/**
 * Webhook handler para eventos de Fintoc
 * Recibe notificaciones cuando un pago se completa, falla, etc.
 */
router.post('/', async (req, res) => {
    const event = req.body;
    const signature = req.headers['fintoc-signature'] || req.headers['x-fintoc-signature'];

    console.log('🔔 [Fintoc IPN] Evento recibido:', event?.type);
    console.log('🔔 [Fintoc IPN] Metadata:', event?.data?.metadata);

    try {
        // 🔐 PASO 1: Verificar firma del webhook
        const payloadString = JSON.stringify(req.body);
        const isValid = verifyFintocWebhook(payloadString, signature);

        if (!isValid) {
            console.error('❌ [Fintoc IPN] Firma inválida');
            return res.status(401).json({ ok: false, error: 'Invalid signature' });
        }

        // ✅ PASO 2: Procesar evento según tipo
        const eventType = event?.type;
        const eventData = event?.data;

        if (eventType === 'payment.succeeded' ||
            eventType === 'payment_intent.succeeded' ||
            eventType === 'widget_link.succeeded') {
            // 💰 PAGO EXITOSO - Ejecutar withdrawal inmediato
            const orderId = eventData?.metadata?.orderId;

            if (!orderId) {
                console.error('❌ [Fintoc IPN] No se encontró orderId en metadata');
                return res.status(400).json({ ok: false, error: 'Missing orderId in metadata' });
            }

            const transaction = await Transaction.findOne({ order: orderId });

            if (!transaction) {
                console.error(`❌ [Fintoc IPN] Transacción no encontrada: ${orderId}`);
                return res.status(404).json({ ok: false, error: 'Transaction not found' });
            }

            console.log(`✅ [Fintoc IPN] Pago confirmado para orden: ${orderId}`);

            // Actualizar payin status
            transaction.payinStatus = 'completed';

            // Registrar evento de Fintoc
            if (!transaction.fintocWebhookEvents) {
                transaction.fintocWebhookEvents = [];
            }
            transaction.fintocWebhookEvents.push({
                type: eventType,
                receivedAt: new Date(),
                payload: eventData
            });

            // 🚀 EJECUTAR WITHDRAWAL INMEDIATO (asumir saldo en Vita)
            if (transaction.deferredWithdrawalPayload && transaction.payoutStatus === 'pending') {
                console.log(`[Fintoc IPN] ⭐ Ejecutando withdrawal diferido para orden: ${orderId}`);

                try {
                    const withdrawalResp = await createWithdrawal(transaction.deferredWithdrawalPayload);
                    const wData = withdrawalResp?.data ?? withdrawalResp;

                    transaction.vitaWithdrawalId = wData?.id || wData?.data?.id || null;
                    transaction.payoutStatus = 'processing';
                    transaction.status = 'processing';

                    await transaction.save();

                    console.log(`✅ [Fintoc IPN] Withdrawal ejecutado: ${transaction.vitaWithdrawalId} (amount: ${transaction.deferredWithdrawalPayload.amount})`);

                } catch (withdrawalError) {
                    // 🔄 RETRY: Si falló por precios expirados, refrescar y reintentar
                    const errorData = withdrawalError.response?.data?.error || {};
                    const msg = `${errorData?.message || ''} ${errorData?.details?.message || ''}`.toLowerCase();

                    // 🐛 LOG COMPLETO DEL ERROR PARA DEBUGGING
                    console.error('[Fintoc IPN] ❌ Error ejecutando withdrawal:', withdrawalError.message);
                    console.error('[Fintoc IPN] Status:', withdrawalError.response?.status);
                    console.error('[Fintoc IPN] Error Data:', JSON.stringify(errorData, null, 2));
                    console.error('[Fintoc IPN] Payload que causó el error:', JSON.stringify(transaction.deferredWithdrawalPayload, null, 2));

                    if (msg.includes('precio') || msg.includes('price') || msg.includes('caducaron')) {
                        console.warn('[Fintoc IPN] ⚠️ Precios expirados. Refrescando y reintentando...');

                        try {
                            await forceRefreshPrices();
                            await new Promise(r => setTimeout(r, 1500));

                            const retryResp = await createWithdrawal(transaction.deferredWithdrawalPayload);
                            const retryData = retryResp?.data ?? retryResp;

                            transaction.vitaWithdrawalId = retryData?.id || retryData?.data?.id || null;
                            transaction.payoutStatus = 'processing';
                            transaction.status = 'processing';

                            console.log('✅ [Fintoc IPN] Retry exitoso:', transaction.vitaWithdrawalId);

                        } catch (retryError) {
                            console.error('[Fintoc IPN] ❌ Error en retry:', retryError.message);
                            console.error('[Fintoc IPN] Retry Error Data:', JSON.stringify(retryError.response?.data, null, 2));
                            transaction.payoutStatus = 'failed';
                            transaction.status = 'failed';
                            transaction.errorMessage = retryError.message;
                        }
                    } else {
                        console.error('[Fintoc IPN] ❌ Error ejecutando withdrawal:', withdrawalError.message);
                        transaction.payoutStatus = 'failed';
                        transaction.status = 'failed';
                        transaction.errorMessage = withdrawalError.message;
                    }
                }
            } else {
                // No hay withdrawal diferido, solo marcar como succeeded
                transaction.status = 'succeeded';
            }

            await transaction.save();

            return res.json({ ok: true, message: 'Payment processed successfully' });

        } else if (eventType === 'payment.failed' || eventType === 'widget_link.failed') {
            // ❌ PAGO FALLIDO
            const orderId = eventData?.metadata?.orderId;

            if (orderId) {
                const transaction = await Transaction.findOne({ order: orderId });

                if (transaction) {
                    transaction.payinStatus = 'failed';
                    transaction.status = 'failed';
                    transaction.errorMessage = eventData?.error_message || 'Payment failed';

                    // Registrar evento
                    if (!transaction.fintocWebhookEvents) {
                        transaction.fintocWebhookEvents = [];
                    }
                    transaction.fintocWebhookEvents.push({
                        type: eventType,
                        receivedAt: new Date(),
                        payload: eventData
                    });

                    await transaction.save();

                    console.log(`❌ [Fintoc IPN] Pago fallido para orden: ${orderId}`);
                }
            }

            return res.json({ ok: true, message: 'Payment failure recorded' });

        } else {
            // Otros eventos (payment.pending, etc.)
            console.log(`ℹ️ [Fintoc IPN] Evento no procesado: ${eventType}`);
            return res.json({ ok: true, message: 'Event received but not processed' });
        }

    } catch (error) {
        console.error('❌ [Fintoc IPN] Error procesando webhook:', error.message);

        // Importante: Siempre retornar 200 para que Fintoc no reintente
        // Los errores se loguean pero no se propagan
        return res.json({ ok: false, error: error.message });
    }
});

export default router;
