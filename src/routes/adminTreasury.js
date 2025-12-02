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

// PUT /api/admin/treasury/:id/approve-deposit (On-Ramp)
// Admin confirma que recibió el dinero en Bolivia -> El sistema envía el dinero al destino (vía Vita)
router.put('/:id/approve-deposit', async (req, res) => {
    try {
        const tx = await Transaction.findById(req.params.id);
        if (!tx) return res.status(404).json({ error: 'Transacción no encontrada' });

        // Aquí la lógica mágica:
        // 1. Ya tienes el dinero en Bolivia.
        // 2. Ahora usas tu saldo de Vita Wallet (USD/CLP) para enviar al destino real.

        // Construir payload para Vita (usando datos guardados)
        // OJO: Necesitas convertir el monto BOB a la moneda de tu wallet (ej: USD) o confiar en que Vita haga el cambio si envías otra moneda.
        // Simplificación: Asumimos que tienes saldo y lanzamos el withdrawal.

        /* const payload = {
           amount: tx.amount, // Cuidado con la conversión de moneda aquí
           currency: 'USD', // Ejemplo: Usas tu saldo USD para pagar
           country: tx.country,
           ... datos del beneficiario guardados en tx ...
        };
        const vitaRes = await createWithdrawal(payload);
        tx.vitaResponse = vitaRes;
        */

        tx.status = 'processing'; // O 'succeeded' si el proceso es directo
        await tx.save();

        res.json({ ok: true, message: 'Depósito aprobado. Envío iniciado.' });
    } catch (error) {
        res.status(500).json({ error: 'Error al aprobar depósito.' });
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