import { Router } from 'express';
import Transaction from '../models/Transaction.js';
// --- ESTA LÍNEA ES LA QUE FALTA ---
import { protect, isAdmin } from '../middleware/authMiddleware.js';

const router = Router();

// GET /api/admin/treasury/pending
// Lista transacciones pendientes de verificación manual
router.get('/pending', protect, isAdmin, async (req, res) => {
    try {
        const pending = await Transaction.find({
            status: { $in: ['pending_verification', 'pending_manual_payout'] }
        }).sort({ createdAt: 1 }).populate('createdBy', 'name email');

        res.json({ ok: true, transactions: pending });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: 'Error al cargar tesorería.' });
    }
});

// PUT /api/admin/treasury/:id/approve-deposit
// Acción: Admin confirma que recibió el dinero (On-Ramp)
router.put('/:id/approve-deposit', protect, isAdmin, async (req, res) => {
    try {
        const tx = await Transaction.findById(req.params.id);
        if (!tx) return res.status(404).json({ ok: false, error: 'Transacción no encontrada' });

        // Validamos que esté en el estado correcto para evitar aprobar dos veces
        if (tx.status !== 'pending_verification') {
            return res.status(400).json({ ok: false, error: 'La transacción no está pendiente de verificación.' });
        }

        // Cambiamos estado a 'processing' (o 'succeeded' si el envío es inmediato)
        tx.status = 'processing';
        await tx.save();

        res.json({ ok: true, message: 'Depósito aprobado exitosamente.', transaction: tx });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: 'Error al aprobar depósito.' });
    }
});

export default router;