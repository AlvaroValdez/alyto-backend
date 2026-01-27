import { Router } from 'express';
import Transaction from '../models/Transaction.js';
import { createWithdrawal } from '../services/vitaService.js';
import { vita } from '../config/env.js';

const router = Router();

// GET /api/admin/treasury/pending
// Lista transacciones que requieren acción manual (tesorería)
router.get('/pending', async (req, res) => {
    try {
        const pending = await Transaction.find({
            status: { $in: ['pending_verification', 'pending_manual_payout'] }
        })
            .sort({ createdAt: -1 }) // -1 = descendente (más reciente primero)
            .populate('createdBy', 'name email');

        res.json({ ok: true, transactions: pending });
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Error al cargar tesorería.' });
    }
});

// PUT /api/admin/treasury/:id/approve-deposit
// Admin confirma que el depósito/entrada fue recibido y, si hay payload guardado,
// ejecuta el envío real (withdrawal) en Vita.
router.put('/:id/approve-deposit', async (req, res) => {
    try {
        const tx = await Transaction.findById(req.params.id);
        if (!tx) return res.status(404).json({ ok: false, error: 'Transacción no encontrada.' });

        if (tx.status !== 'pending_verification') {
            return res.status(409).json({
                ok: false,
                error: `Estado inválido para aprobar depósito: ${tx.status}`
            });
        }

        if (!tx.withdrawalPayload) {
            return res.status(422).json({
                ok: false,
                error: 'No existe payload guardado para ejecutar el envío. Revisa la creación de la transacción.'
            });
        }


        // ⚠️ CRÍTICO: Vita NO soporta moneda BOB
        // Si el depósito es en BOB, debemos convertir a CLP primero
        let finalPayload = { ...tx.withdrawalPayload };

        if (tx.currency?.toUpperCase() === 'BOB') {
            console.log('[treasury] 🇧🇴 Depósito BOB detectado - convirtiendo a CLP para Vita...');

            // Obtener tasa de cambio BOB→CLP desde TransactionRules
            const TransactionConfig = (await import('../models/TransactionConfig.js')).default;
            const config = await TransactionConfig.findOne({
                originCountry: 'BO',
                isEnabled: true
            });

            if (!config || !config.manualExchangeRate || config.manualExchangeRate <= 0) {
                throw new Error('No hay configuración de tasa BOB→CLP en TransactionRules. Configure manualExchangeRate para BO.');
            }

            const bobAmount = tx.amount;
            const bobToClpRate = config.manualExchangeRate; // 1 BOB = X CLP
            const clpEquivalent = Math.round(bobAmount * bobToClpRate);

            // 💰 Calcular comisión
            let feeCLP = 0;
            let feePercent = 0;
            let feeOriginAmount = 0;

            if (config.feeType === 'percentage') {
                feePercent = config.feeAmount || 0;
                feeCLP = Math.round(clpEquivalent * (feePercent / 100));
                feeOriginAmount = Number((bobAmount * (feePercent / 100)).toFixed(2));
            } else if (config.feeType === 'fixed') {
                feeCLP = config.feeAmount || 0;
                feePercent = clpEquivalent > 0 ? Number(((feeCLP / clpEquivalent) * 100).toFixed(2)) : 0;
                feeOriginAmount = Number((feeCLP / bobToClpRate).toFixed(2));
            }

            const clpWithFee = clpEquivalent + feeCLP;

            // Guardar comisión en transacción
            tx.fee = feeCLP;
            tx.feePercent = feePercent;
            tx.feeOriginAmount = feeOriginAmount;
            await tx.save();

            console.log(`[treasury] Conversión: ${bobAmount} BOB × ${bobToClpRate} = ${clpEquivalent} CLP`);
            console.log(`[treasury] 💰 Comisión: ${feePercent}% = ${feeCLP} CLP (${feeOriginAmount} BOB)`);
            console.log(`[treasury] Total a debitar wallet: ${clpWithFee} CLP`);

            // Modificar payload para usar CLP
            finalPayload = {
                ...tx.withdrawalPayload,
                currency: 'clp',
                amount: clpWithFee, // ✅ Incluye comisión
                purpose_comentary: `BOB ${bobAmount} → CLP ${clpEquivalent} + fee ${feeCLP}`
            };

            // 🔄 Eliminar campos de quote expirado (Vita calculará frescos)
            delete finalPayload.rate;
            delete finalPayload.estimated_amount;
            delete finalPayload.fee;
            delete finalPayload.expires_at;

            console.log('[treasury] ✅ Payload con fee:', {
                original: { currency: 'bob', amount: bobAmount },
                converted: { currency: 'clp', amount: clpEquivalent, fee: feeCLP, total: clpWithFee }
            });
        }

        // 🔄 CRÍTICO: Refrescar quote para obtener precios actuales de Vita
        // Esto soluciona el error "Los precios caducaron"
        try {
            // ✅ FIX: Obtener destCountry de múltiples fuentes posibles
            const destCountry = tx.country || tx.destCountry || tx.withdrawalPayload?.destination_country;
            const originCurrency = finalPayload.currency?.toUpperCase() || 'CLP';
            const originCountry = originCurrency === 'CLP' ? 'CL' : (tx.originCountry || 'CL');
            const amountForQuote = finalPayload.amount; // CLP amount (with fee if BOB)

            if (!destCountry) {
                throw new Error('[treasury] destCountry no está definido. Verifica tx.country o tx.destCountry');
            }

            console.log(`[treasury] 🔄 Refrescando quote: ${amountForQuote} ${originCurrency} (${originCountry}) → ${destCountry}`);

            // ✅ FIX: Call internal logic directly to avoid self-HTTP 500 Deadlock
            const { calculateQuote } = await import('../services/fxCalculator.js');
            const freshQuote = await calculateQuote({
                amount: amountForQuote,
                origin: originCurrency,
                originCountry: originCountry,
                destCountry: destCountry,
                mode: 'send'
            });

            // Simulate API response structure for minimal code change below
            const quoteResponse = { data: { ok: true, data: freshQuote } };

            if (quoteResponse.data.ok) {
                const freshQuote = quoteResponse.data.data;

                // DEBUG: Confirm code version and inspected keys
                console.log('[treasury] 🛠️ DEBUG: Validando respuesta de quote (versión parcheada)');
                console.log('[treasury] Keys recibidas:', Object.keys(freshQuote));

                console.log('[treasury] ✅ Quote refrescado:', {
                    rate: freshQuote.rate,
                    estimated: freshQuote.amountOut,
                    payoutCost: freshQuote.payoutFixedCost
                });

                // Actualizar transacción con tracking data fresco
                tx.rateTracking = {
                    vitaRate: freshQuote.rate || 0,
                    alytoRate: freshQuote.rateWithMarkup || freshQuote.rate || 0,
                    spreadPercent: freshQuote.spread || 0,
                    profitDestCurrency: 0 // Se calculará si aplica
                };

                tx.amountsTracking = {
                    originCurrency: tx.currency,
                    originPrincipal: tx.amount,
                    originFee: tx.fee || 0,
                    originTotal: tx.amount + (tx.fee || 0),
                    originTotal: tx.amount + (tx.fee || 0),
                    destCurrency: freshQuote.destCurrency,
                    destGrossAmount: (freshQuote.amountOut || freshQuote.receiveAmount || 0) + (freshQuote.payoutFixedCost || 0),
                    destVitaFixedCost: freshQuote.payoutFixedCost || 0,
                    destReceiveAmount: freshQuote.amountOut || freshQuote.receiveAmount || 0
                };

                // Safety check for NaN
                if (isNaN(tx.amountsTracking.destGrossAmount)) {
                    console.error('[treasury] ⚠️ Error de cálculo NaN en destGrossAmount. Usando valores seguros.');
                    tx.amountsTracking.destGrossAmount = 0;
                    tx.amountsTracking.destReceiveAmount = 0;
                }

                await tx.save();

                // Usar valores frescos en payload final para Vita
                // ⚠️ CRÍTICO: Reconstruir payload explícitamente para evitar campos basura que rompan la firma (Error 303)
                const basePayload = tx.withdrawalPayload || {};

                // Extraer compliance fields (fc_*)
                const complianceFields = Object.keys(basePayload)
                    .filter(key => key.startsWith('fc_'))
                    .reduce((obj, key) => {
                        obj[key] = basePayload[key];
                        return obj;
                    }, {});

                finalPayload = {
                    transactions_type: 'withdrawal',
                    order: tx.order,
                    url_notify: process.env.VITA_NOTIFY_URL || basePayload.url_notify,
                    wallet: vita.walletUUID,

                    currency: (freshQuote.destCurrency || basePayload.currency || '').toLowerCase(),
                    country: (destCountry || basePayload.country || '').toUpperCase(),
                    amount: freshQuote.amount || basePayload.amount, // Input Amount (Cost) // Vita expects 'amount' to be the COST for withdrawal? No, amount usually IS the send amount. Wait.
                    // Vita /transactions (withdrawal): amount is the amount to WITHDRAW from execution currency? 
                    // Verify logic: withdrawals.js sends 'adjustedWithdrawalAmount'.
                    // Here we calculated everything in CLP.
                    // freshQuote.amount is Input(CLP).
                    // We want to send THAT amount.
                    amount: Number(freshQuote.amount || basePayload.amount),

                    // Beneficiary Data
                    beneficiary_type: basePayload.beneficiary_type,
                    beneficiary_first_name: basePayload.beneficiary_first_name,
                    beneficiary_last_name: basePayload.beneficiary_last_name,
                    beneficiary_email: basePayload.beneficiary_email,
                    beneficiary_address: basePayload.beneficiary_address || 'N/A',
                    beneficiary_document_type: basePayload.beneficiary_document_type,
                    beneficiary_document_number: basePayload.beneficiary_document_number,

                    // Bank Data
                    account_type_bank: basePayload.account_type_bank,
                    account_bank: basePayload.account_bank,
                    bank_code: basePayload.bank_code ? Number(basePayload.bank_code) : undefined,

                    // Metadata
                    purpose: basePayload.purpose,
                    purpose_comentary: basePayload.purpose_comentary || 'Pago manual',

                    // Compliance
                    ...complianceFields
                };

                // 🧹 HELPER: Remove undefined/null/empty strings from payload
                // Mirrors 'withdrawals.js' / 'buildFinalCustomerData' logic
                const cleanObject = (obj) => {
                    return Object.fromEntries(
                        Object.entries(obj).filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== '')
                    );
                };

                finalPayload = cleanObject(finalPayload);

                // Validation Warning
                if (!finalPayload.wallet) {
                    console.warn('[treasury] ⚠️ ADVERTENCIA: wallet (UUID) no está definido en el payload. La transacción podría fallar.');
                }

                console.log('[treasury] 📦 Payload RECONSTRUIDO (Clean & Filtered):', JSON.stringify(finalPayload, null, 2));

                console.log('[treasury] 📦 Payload RECONSTRUIDO (Clean):', JSON.stringify(finalPayload, null, 2));
            } else {
                console.warn('[treasury] ⚠️ Error en respuesta de quote, usando valores guardados');
            }
        } catch (quoteError) {
            console.warn('[treasury] ⚠️ Error refrescando quote:', quoteError.message);
            console.warn('[treasury] Continuando con valores guardados del payload original');
            // No bloqueamos la aprobación si falla el refresh
        }

        // Ejecutar envío real en Vita
        tx.status = 'processing';
        await tx.save();

        const vitaRes = await createWithdrawal(finalPayload);
        tx.vitaResponse = vitaRes;
        tx.status = 'processing'; // IPN debe marcar succeeded/failed
        await tx.save();

        // ✅ FIX: Generar y enviar comprobante automáticamente
        try {
            const { generateAndSendReceipt } = await import('../services/receipt/receiptGenerator.js');
            await generateAndSendReceipt(tx._id.toString());
            console.log('[treasury] ✅ Comprobante generado y enviado');
        } catch (receiptError) {
            console.error('[treasury] ⚠️ Error generando comprobante:', receiptError.message);
            // No bloquear la aprobación si falla el comprobante
        }

        res.json({
            ok: true,
            message: tx.currency === 'BOB'
                ? 'Depósito BOB aprobado y convertido a CLP. Envío iniciado en Vita.'
                : 'Depósito aprobado. Envío iniciado en Vita.',
            vita: vitaRes
        });
    } catch (error) {
        const vitaErr = error?.response?.data;
        if (error?.response?.status) {
            return res.status(error.response.status).json({
                ok: false,
                error: 'Vita API Error',
                details: vitaErr
            });
        }

        res.status(500).json({ ok: false, error: 'Error al aprobar depósito.' });
    }
});

// PUT /api/admin/treasury/:id/complete-payout
// Admin confirma que ya transfirió el dinero en el off-ramp manual (ej: Bolivia)
router.put('/:id/complete-payout', async (req, res) => {
    try {
        const tx = await Transaction.findById(req.params.id);
        if (!tx) return res.status(404).json({ ok: false, error: 'Transacción no encontrada.' });

        if (tx.status !== 'pending_manual_payout') {
            return res.status(409).json({
                ok: false,
                error: `Estado inválido para completar pago: ${tx.status}`
            });
        }

        const { proofUrl, transferDetails, adminNotes } = req.body || {};

        // ⚠️ Validación: Bolivia requiere comprobante obligatorio
        if (tx.country?.toUpperCase() === 'BO' && !proofUrl) {
            return res.status(400).json({
                ok: false,
                error: 'Para Bolivia se requiere comprobante de transferencia (proofUrl)'
            });
        }

        // Guardar información de la transferencia
        if (proofUrl) tx.proofOfPayment = proofUrl;
        if (transferDetails) tx.manualPayoutDetails = transferDetails;
        if (adminNotes) tx.adminNotes = adminNotes;

        // Registrar quién aprobó y cuándo
        tx.approvedDepositBy = req.user?._id;
        tx.approvedDepositAt = new Date();

        tx.status = 'succeeded';
        await tx.save();

        res.json({
            ok: true,
            message: 'Pago marcado como completado.',
            transaction: tx
        });
    } catch (error) {
        console.error('[treasury] Error completando payout:', error);
        res.status(500).json({ ok: false, error: 'Error al completar pago.' });
    }
});

// PUT /api/admin/treasury/:id/reject
// Admin rechaza la transacción por comprobante inválido o error
router.put('/:id/reject', async (req, res) => {
    try {
        const tx = await Transaction.findById(req.params.id);
        if (!tx) return res.status(404).json({ ok: false, error: 'Transacción no encontrada.' });

        if (tx.status !== 'pending_verification') {
            return res.status(409).json({
                ok: false,
                error: `Estado inválido para rechazar: ${tx.status}`
            });
        }

        const { reason } = req.body;
        if (!reason || !reason.trim()) {
            return res.status(400).json({ ok: false, error: 'Se requiere una razón de rechazo' });
        }

        tx.status = 'rejected';
        tx.rejectionReason = reason;
        tx.rejectedBy = req.user?._id;
        tx.rejectedAt = new Date();
        await tx.save();

        // TODO: Enviar notificación al usuario (email/push notification)
        console.log(`[treasury] ❌ Transacción ${tx._id} rechazada por:`, req.user?.email || 'admin');
        console.log(`[treasury] Razón: ${reason}`);

        res.json({
            ok: true,
            message: 'Transacción rechazada exitosamente',
            transaction: tx
        });
    } catch (error) {
        console.error('[treasury] Error rechazando transacción:', error);
        res.status(500).json({ ok: false, error: 'Error al rechazar transacción' });
    }
});

// DELETE /api/admin/treasury/clear-all
// PELIGROSO: Elimina TODAS las transacciones de la base de datos
router.delete('/clear-all', async (req, res) => {
    try {
        console.log('⚠️ [ADMIN] Clearing ALL transactions from database...');

        const result = await Transaction.deleteMany({});

        console.log(`🗑️ [ADMIN] Deleted ${result.deletedCount} transactions`);

        res.json({
            ok: true,
            message: `Successfully deleted ${result.deletedCount} transactions`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error('❌ [ADMIN] Error clearing transactions:', error);
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

export default router;
