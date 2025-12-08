import { Router } from 'express';
import Transaction from '../models/Transaction.js';
import { createWithdrawal } from '../services/vitaService.js'; // Para ejecutar el envío real tras aprobar depósito

const router = Router();

// GET /api/admin/treasury/pending
// Lista transacciones que requieren acción manual
router.get('/pending', async (req, res) => {
    try {
        const pending = await Transaction.find({
            status: { $in: ['pending_verification', 'pending_manual_payout'] }
        }).sort({ createdAt: 1 }).populate('createdBy', 'name email');
        res.json({ ok: true, transactions: pending });
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Error al cargar tesorería.' });
    }
});

// PUT /api/admin/treasury/:id/approve-deposit
// Acción: Admin confirma que recibió el dinero (On-Ramp)
router.put('/:id/approve-deposit', protect, isAdmin, async (req, res) => {
    try {
        const tx = await Transaction.findById(req.params.id);
        if (!tx) return res.status(404).json({ ok: false, error: 'Transacción no encontrada' });

        if (tx.status !== 'pending_verification') {
            return res.status(400).json({ ok: false, error: 'La transacción no está pendiente de verificación.' });
        }

        // ACTUALIZACIÓN DE ESTADO
        // Pasamos a 'processing' para indicar que el dinero entró.
        // (Aquí podrías disparar el envío automático a Vita Wallet si tuvieramos el monto de salida calculado)
        tx.status = 'processing';
        await tx.save();

        res.json({ ok: true, message: 'Depósito aprobado exitosamente.', transaction: tx });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: 'Error al aprobar depósito.' });
    }
});

// PUT /api/admin/treasury/:id/complete-payout (Off-Ramp)
// Admin confirma que ya transfirió el dinero en Bolivia
router.put('/:id/complete-payout', async (req, res) => {
    try {
        const tx = await Transaction.findById(req.params.id);
        tx.status = 'succeeded';
        // tx.proofOfPayment = req.body.proofUrl; // Opcional: guardar comprobante de salida
        await tx.save();
        res.json({ ok: true, message: 'Pago marcado como completado.' });
    } catch (error) {
        res.status(500).json({ error: 'Error al completar pago.' });
    }
});

export default router;