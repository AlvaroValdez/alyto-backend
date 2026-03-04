import { Router } from 'express';
import Transaction from '../models/Transaction.js';
import { createWithdrawal, forceRefreshPrices } from '../services/vitaService.js';
import { vita } from '../config/env.js';
import { adminTreasuryLimiter } from '../middleware/rateLimiters.js';
import { notifyManualPayoutCompleted, notifyProofUploaded, notifyTransactionRejected } from '../services/notificationService.js';

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
router.put('/:id/approve-deposit', adminTreasuryLimiter, async (req, res) => {
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


        // ===================================================================
        // ANCHOR MANUAL: Depósito BOB
        // ===================================================================
        // Vita NO soporta BOB. El flujo correcto es:
        //   1. Leer el monto prometido en COP guardado en la cotización original.
        //   2. Obtener la tasa CLP→COP LIVE de Vita (precio fresco).
        //   3. Calcular el CLP mínimo necesario para depositar exactamente el COP prometido.
        //   4. Enviarle ese monto (CLP) a Vita → el excedente queda como GANANCIA de Alyto.
        // ===================================================================
        let finalPayload = { ...tx.withdrawalPayload };
        let profitCLP = 0;  // Ganancia en CLP a registrar
        let amountToSendToVita = 0; // CLP que se le envían a Vita

        if (tx.currency?.toUpperCase() === 'BOB') {
            console.log('[treasury] 🇧🇴 Depósito BOB detectado - calculando CLP exacto para Vita...');

            // ─── Obtener config manual de Bolivia ──────────────────────────
            const TransactionConfig = (await import('../models/TransactionConfig.js')).default;
            const config = await TransactionConfig.findOne({ originCountry: 'BO', isEnabled: true });
            if (!config || !config.manualExchangeRate || config.manualExchangeRate <= 0) {
                throw new Error('No hay configuración de tasa BOB→CLP. Configure manualExchangeRate para BO.');
            }

            const bobAmount = tx.amount;                          // Ej: 1.000 BOB
            const bobToClpBase = config.manualExchangeRate;       // Ej: 95 CLP/BOB (tasa base sin margen)
            const feeType = config.feeType || 'percentage';
            const feeAmount = Number(config.feeAmount || 0);

            // Tasa ajustada que usa fx.js para la cotización (margen incluido en tasa)
            const adjustedBobToClp = feeType === 'percentage'
                ? bobToClpBase * (1 - feeAmount / 100)
                : bobToClpBase;

            // CLP que corresponden al remitente (principal Alyto neto)
            const clpPrincipal = Math.round(bobAmount * adjustedBobToClp); // Ej: 86.450 CLP

            // CLP que corresponden al margen de Alyto (ganancia interna)
            const marginCLP = Math.round(bobAmount * (bobToClpBase - adjustedBobToClp)); // Ej: 8.550 CLP

            console.log(`[treasury] 📊 BOB Breakdown:`);
            console.log(`   ${bobAmount} BOB × ${bobToClpBase} (base) = ${bobAmount * bobToClpBase} CLP bruto`);
            console.log(`   Margen Alyto: ${feeAmount}% = ${marginCLP} CLP`);
            console.log(`   CLP para enviar a destino: ${clpPrincipal} CLP`);

            // ─── Obtener monto prometido de la cotización original ─────────
            // Este es el monto EXACTO que el usuario fue cotizado.
            // Si no está guardado (transacciones antiguas), lo recalculamos.
            const { getListPrices } = await import('../services/vitaService.js');
            const prices = await getListPrices();
            const destCountryCode = tx.country?.toUpperCase();
            const priceData = prices.find(p => p.code?.toUpperCase() === destCountryCode);

            if (!priceData) {
                throw new Error(`No hay tasa Vita disponible para ${destCountryCode}. Verifica precios de Vita.`);
            }

            const clpToCopRate = Number(priceData.rate); // Tasa pura CLP→COP de Vita (live)
            const vitaFixedCost = Number(priceData.fixedCost || 0);

            // Monto prometido = guardado en la transacción, o recalculado si no está
            let promisedCOP = tx.amountsTracking?.destReceiveAmount;
            if (!promisedCOP || promisedCOP <= 0) {
                // Recomputar: clpPrincipal → COP
                promisedCOP = Math.round(clpPrincipal * clpToCopRate - vitaFixedCost);
                console.warn(`[treasury] ⚠️ destReceiveAmount no guardado. Recalculando: ${promisedCOP} COP`);
            }

            // ─── CLP exacto a enviar a Vita ────────────────────────────────
            // Para que el beneficiario reciba 'promisedCOP', necesitamos:
            // CLP = (promisedCOP + fixedCost_COP) / clpToCopRate
            const clpNeededByVita = Math.ceil((promisedCOP + vitaFixedCost) / clpToCopRate);
            amountToSendToVita = clpNeededByVita;

            // ─── Ganancia de Alyto ─────────────────────────────────────────
            // Alyto tiene 'clpPrincipal' CLP disponibles en su wallet para este envío.
            // Vita consumirá 'clpNeededByVita' CLP.
            // La diferencia es la ganancia real de Alyto en CLP.
            profitCLP = clpPrincipal - clpNeededByVita;
            const profitCOP = Math.round(profitCLP * clpToCopRate);

            console.log(`[treasury] 💰 CLP a enviar a Vita: ${clpNeededByVita} (para garantizar ${promisedCOP} COP al beneficiario)`);
            console.log(`[treasury] 💰 Ganancia Alyto: ${profitCLP} CLP (~${profitCOP} COP)`);
            console.log(`[treasury] 💰 Margen BOB manual: ${marginCLP} CLP (queda en wallet como ingreso por exchange rate)`);

            // ─── Actualizar tracking en BD ─────────────────────────────────
            // IMPORTANTE: Guardamos tasas en unidades BOB→COP para que la
            // tabla del admin muestre valores comparables u homogeíneos.
            // Tasa Vita (BOB→COP puro): si Vita convirtiera el BOB directamente
            //   = bobToClpBase (95) × clpToCopRate (4.36) = ~414.2 COP/BOB
            // Tasa Alyto (BOB→COP cliente): monto prometido / monto BOB enviado
            //   = promisedCOP / bobAmount  (ej: 398.495 / 1000 = 0.3985 COP/BOB)
            const vitaRateBOBtoCOP = Number((bobToClpBase * clpToCopRate).toFixed(4)); // COP por 1 BOB (puro Vita)
            const alytoRateBOBtoCOP = Number((promisedCOP / bobAmount).toFixed(4));    // COP por 1 BOB (lo que recibe el cliente)

            console.log(`[treasury] 📊 Tasa Vita  (BOB→COP): ${vitaRateBOBtoCOP} COP/BOB`);
            console.log(`[treasury] 📊 Tasa Alyto (BOB→COP): ${alytoRateBOBtoCOP} COP/BOB`);
            console.log(`[treasury] 📊 Diferencial (ganancia por BOB): ${(vitaRateBOBtoCOP - alytoRateBOBtoCOP).toFixed(2)} COP/BOB × ${bobAmount} = ${Math.round((vitaRateBOBtoCOP - alytoRateBOBtoCOP) * bobAmount)} COP`);

            tx.rateTracking = {
                vitaRate: vitaRateBOBtoCOP,    // COP que Vita puede dar por 1 BOB (sin margen Alyto)
                alytoRate: alytoRateBOBtoCOP,  // COP que recibe el cliente por 1 BOB (con margen Alyto)
                spreadPercent: Number(feeAmount.toFixed(2)),
                profitDestCurrency: Number(profitCOP.toFixed(0)),
                // Tasas de apoyo (CLP→COP) para backend/debug
                clpToCopRate: Number(clpToCopRate.toFixed(4)),
                bobToClpBase: Number(bobToClpBase.toFixed(4))
            };

            tx.amountsTracking = {
                originCurrency: 'BOB',
                originPrincipal: Number(bobAmount),           // 1.000 BOB (lo que envió el cliente)
                originFee: 0,                                  // La comisión está en la tasa, no visible
                originTotal: Number(bobAmount),                // 1.000 BOB (total origen)

                destCurrency: priceData.code?.toUpperCase() || destCountryCode,
                destGrossAmount: Number(promisedCOP + vitaFixedCost),
                destVitaFixedCost: Number(vitaFixedCost),
                destReceiveAmount: Number(promisedCOP),        // Lo que prometiste al beneficiario

                profitOriginCurrency: Number(profitCLP),      // Ganancia en CLP
                profitDestCurrency: Number(profitCOP)         // Ganancia en COP (aprox)
            };

            tx.fee = marginCLP;         // Margen obtenido por la tasa diferencial BOB→CLP
            tx.feeOriginAmount = Number((marginCLP / bobToClpBase).toFixed(3)); // Equiv en BOB
            tx.feePercent = feeAmount;

            await tx.save();

            // ─── Construir payload para Vita ───────────────────────────────
            const basePayload = tx.withdrawalPayload || {};
            const complianceFields = Object.keys(basePayload)
                .filter(key => key.startsWith('fc_'))
                .reduce((obj, key) => { obj[key] = basePayload[key]; return obj; }, {});

            finalPayload = {
                transactions_type: 'withdrawal',
                order: tx.order,
                url_notify: (process.env.VITA_NOTIFY_URL || basePayload.url_notify || '').trim(),
                wallet: vita.walletUUID,
                currency: 'clp',                              // Fuente: wallet CLP de Alyto
                country: destCountryCode,
                amount: amountToSendToVita,                   // CLP mínimos para el payout prometido

                beneficiary_type: basePayload.beneficiary_type,
                beneficiary_first_name: basePayload.beneficiary_first_name,
                beneficiary_last_name: basePayload.beneficiary_last_name,
                beneficiary_email: basePayload.beneficiary_email,
                beneficiary_address: basePayload.beneficiary_address || 'N/A',
                beneficiary_document_type: basePayload.beneficiary_document_type,
                beneficiary_document_number: basePayload.beneficiary_document_number,
                account_type_bank: basePayload.account_type_bank,
                account_bank: basePayload.account_bank,
                bank_code: basePayload.bank_code ? Number(basePayload.bank_code) : undefined,
                purpose: basePayload.purpose,
                purpose_comentary: `BOB ${bobAmount} → ${promisedCOP} COP (via ${clpNeededByVita} CLP)`,
                ...complianceFields
            };

            // Limpiar campos vacíos/nulos
            finalPayload = Object.fromEntries(
                Object.entries(finalPayload).filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== '')
            );

            console.log('[treasury] ✅ Payload final:', {
                currency: finalPayload.currency,
                country: finalPayload.country,
                amount: finalPayload.amount,
                promisedCOP, vitaFixedCost, clpToCopRate
            });

        } else {
            // ===================================================================
            // FLUJO NO-BOB: Refrescar quote para evitar "Precios caducados"
            // ===================================================================
            try {
                const destCountry = tx.country || tx.destCountry || tx.withdrawalPayload?.destination_country;
                const originCurrency = (finalPayload.currency?.toUpperCase() || 'CLP');
                const amountForQuote = finalPayload.amount;

                if (!destCountry) throw new Error('destCountry no definido');

                const { calculateQuote } = await import('../services/fxCalculator.js');
                const freshQuote = await calculateQuote({
                    amount: amountForQuote,
                    origin: originCurrency,
                    originCountry: 'CL',
                    destCountry,
                    mode: 'send'
                });

                if (freshQuote && !freshQuote.error) {
                    const basePayload2 = tx.withdrawalPayload || {};
                    const complianceFields2 = Object.keys(basePayload2)
                        .filter(k => k.startsWith('fc_'))
                        .reduce((obj, k) => { obj[k] = basePayload2[k]; return obj; }, {});

                    const promisedDestAmount = tx.amountsTracking?.destReceiveAmount || freshQuote.receiveAmount || 0;
                    const liveVitaRate = freshQuote.rateTracking?.vitaRate || 1;
                    const liveClpNeeded = Math.ceil((promisedDestAmount + (freshQuote.payoutFixedCost || 0)) / liveVitaRate);
                    const profitCLPNonBOB = amountForQuote - liveClpNeeded;

                    tx.rateTracking = {
                        vitaRate: Number(liveVitaRate.toFixed(4)),
                        alytoRate: Number((freshQuote.rateTracking?.alytoRate || freshQuote.rate || liveVitaRate).toFixed(4)),
                        spreadPercent: freshQuote.rateTracking?.spreadPercent || 0,
                        profitDestCurrency: Math.round(profitCLPNonBOB * liveVitaRate)
                    };

                    tx.amountsTracking = {
                        ...tx.amountsTracking,
                        profitOriginCurrency: Number(profitCLPNonBOB.toFixed(0)),
                        profitDestCurrency: Math.round(profitCLPNonBOB * liveVitaRate)
                    };

                    await tx.save();

                    finalPayload = Object.fromEntries(Object.entries({
                        transactions_type: 'withdrawal',
                        order: tx.order,
                        url_notify: (process.env.VITA_NOTIFY_URL || basePayload2.url_notify || '').trim(),
                        wallet: vita.walletUUID,
                        currency: (freshQuote.originCurrency || 'CLP').toLowerCase(),
                        country: destCountry.toUpperCase(),
                        amount: liveClpNeeded,
                        beneficiary_type: basePayload2.beneficiary_type,
                        beneficiary_first_name: basePayload2.beneficiary_first_name,
                        beneficiary_last_name: basePayload2.beneficiary_last_name,
                        beneficiary_email: basePayload2.beneficiary_email,
                        beneficiary_address: basePayload2.beneficiary_address || 'N/A',
                        beneficiary_document_type: basePayload2.beneficiary_document_type,
                        beneficiary_document_number: basePayload2.beneficiary_document_number,
                        account_type_bank: basePayload2.account_type_bank,
                        account_bank: basePayload2.account_bank,
                        bank_code: basePayload2.bank_code ? Number(basePayload2.bank_code) : undefined,
                        purpose: basePayload2.purpose,
                        purpose_comentary: basePayload2.purpose_comentary || 'Pago manual',
                        ...complianceFields2
                    }).filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== ''));
                }
            } catch (quoteErr) {
                console.warn('[treasury] ⚠️ Error refrescando quote non-BOB:', quoteErr.message);
            }
        }

        // Ejecutar envío real en Vita
        tx.status = 'processing';
        await tx.save();

        let vitaRes;
        try {
            vitaRes = await createWithdrawal(finalPayload);
        } catch (firstError) {
            const errorData = firstError.response?.data?.error || {};
            const msg = `${errorData?.message || ''}`.toLowerCase();
            if (msg.includes('precio') || msg.includes('price') || msg.includes('caducaron')) {
                console.warn('⚠️ [treasury] Precios de Vita expirados. Refrescando y reintentando...');
                await forceRefreshPrices();
                await new Promise(r => setTimeout(r, 1500));
                vitaRes = await createWithdrawal(finalPayload);
                console.log('✅ [treasury] Reintento exitoso tras refrescar precios.');
            } else {
                throw firstError;
            }
        }

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
        const tx = await Transaction.findById(req.params.id).populate('createdBy', 'email fcmToken');
        if (!tx) return res.status(404).json({ ok: false, error: 'Transacción no encontrada.' });

        if (tx.status !== 'pending_manual_payout') {
            return res.status(409).json({
                ok: false,
                error: `Estado inválido para completar pago: ${tx.status}. Debe estar en 'pending_manual_payout'.`
            });
        }

        const { proofUrl, transferDetails, adminNotes } = req.body || {};

        // ⚠️ Advertencia: Recomendar comprobante para Bolivia
        if (tx.country?.toUpperCase() === 'BO' && !proofUrl) {
            console.warn('[treasury] ⚠️ Completando payout a Bolivia sin comprobante. Recomendado agregar proofUrl.');
        }

        // Guardar información de la transferencia
        if (proofUrl) tx.proofOfPayment = proofUrl;
        if (transferDetails) tx.manualPayoutDetails = transferDetails;
        if (adminNotes) tx.adminNotes = adminNotes;

        // Registrar quién aprobó y cuándo
        tx.approvedDepositBy = req.user?._id;
        tx.approvedDepositAt = new Date();

        // Actualizar estados
        tx.payoutStatus = 'completed'; // ⭐ IMPORTANTE
        tx.status = 'succeeded';
        await tx.save();

        // 🔔 U6 — Notificar usuario: payout Bolivia completado
        notifyManualPayoutCompleted(tx).catch(() => { });

        console.log(`✅ [treasury] Payout manual completado: ${tx.order} (${tx.country})`);

        res.json({
            ok: true,
            message: 'Payout marcado como completado.',
            transaction: tx
        });
    } catch (error) {
        console.error('[treasury] Error completando payout:', error);
        res.status(500).json({ ok: false, error: 'Error al completar pago.' });
    }
});

// PUT /api/admin/treasury/:id/upload-proof
// Admin sube el comprobante de pago para un payout manual
router.put('/:id/upload-proof', async (req, res) => {
    try {
        const tx = await Transaction.findById(req.params.id);
        if (!tx) return res.status(404).json({ ok: false, error: 'Transacción no encontrada.' });

        const { proofUrl } = req.body;

        if (!proofUrl) {
            return res.status(400).json({
                ok: false,
                error: 'proofUrl es requerido'
            });
        }

        // Actualizar comprobante
        tx.proofOfPayment = proofUrl;
        await tx.save();

        // 🔔 U7 — Notificar usuario: comprobante disponible
        notifyProofUploaded(tx).catch(() => { });

        console.log(`✅ [treasury] Comprobante de pago agregado para: ${tx.order}`);

        res.json({
            ok: true,
            message: 'Comprobante de pago actualizado.',
            proofUrl,
            transaction: tx
        });
    } catch (error) {
        console.error('[treasury] Error subiendo comprobante:', error);
        res.status(500).json({ ok: false, error: 'Error al subir comprobante.' });
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

        // 🔔 U11 — Notificar usuario: transacción rechazada
        notifyTransactionRejected(tx, reason).catch(() => { });

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
