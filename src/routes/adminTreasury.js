import { Router } from 'express';
import Transaction from '../models/Transaction.js';
import { protect, isAdmin } from '../middleware/authMiddleware.js';

const router = Router();

// GET /api/admin/treasury/pending (Listar pendientes)
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
// ACCIÓN CLAVE: El Admin confirma que el dinero llegó al banco
router.put('/:id/approve-deposit', protect, isAdmin, async (req, res) => {
    try {
        const tx = await Transaction.findById(req.params.id);

        if (!tx) {
            return res.status(404).json({ ok: false, error: 'Transacción no encontrada' });
        }

        // Validar estado actual para evitar errores
        if (tx.status !== 'pending_verification') {
            return res.status(400).json({ ok: false, error: 'La transacción no está pendiente de verificación.' });
        }

        // CAMBIO DE ESTADO
        // 'processing' indica que el dinero ya entró y ahora el sistema (o tú) debe enviarlo al destino.
        tx.status = 'processing';

        // Opcional: Aquí podrías disparar el envío automático a Vita Wallet si tuvieramos saldo
        // Por ahora, solo confirmamos la recepción.

        await tx.save();

        res.json({ ok: true, message: 'Depósito aprobado. La transacción está en proceso.', transaction: tx });
    } catch (error) {
        console.error("Error approving deposit:", error);
        res.status(500).json({ ok: false, error: 'Error al aprobar el depósito.' });
    }
});

// PUT /api/admin/treasury/:id/complete-manual-payout
// Acción: Admin confirma que YA envió el dinero al beneficiario
router.put('/:id/complete-manual-payout', protect, isAdmin, async (req, res) => {
    try {
        const tx = await Transaction.findById(req.params.id);

        if (!tx) return res.status(404).json({ ok: false, error: 'Transacción no encontrada' });

        // Solo permitimos completar si ya fue aprobada previamente (processing)
        if (tx.status !== 'processing') {
            return res.status(400).json({ ok: false, error: 'La transacción debe estar "En Proceso" para poder finalizarla.' });
        }

        tx.status = 'succeeded';
        await tx.save();

        res.json({ ok: true, message: 'Transacción marcada como COMPLETADA exitosamente.', transaction: tx });
    } catch (error) {
        console.error("Error completing payout:", error);
        res.status(500).json({ ok: false, error: 'Error al finalizar la transacción.' });
    }
});

export default router;