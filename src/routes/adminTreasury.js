import { Router } from 'express';
import Transaction from '../models/Transaction.js';
import { createWithdrawal } from '../services/vitaService.js';

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

        // Ejecutar envío real en Vita
        tx.status = 'processing';
        await tx.save();

        const vitaRes = await createWithdrawal(finalPayload);
        tx.vitaResponse = vitaRes;
        tx.status = 'processing'; // IPN debe marcar succeeded/failed
        await tx.save();

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

export default router;

