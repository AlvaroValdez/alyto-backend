import { Router } from 'express';
import Transaction from '../models/Transaction.js';
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

// GET /api/transactions
// Historial con filtros y permisos de rol
router.get('/', protect, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, country } = req.query;

    let query = {};

    // 1. PERMISOS: Si NO es admin, forzamos a ver solo sus propias transacciones.
    // Si ES admin, no agregamos esta restricción (ve todo).
    if (req.user.role !== 'admin') {
      query.createdBy = req.user._id;
    }

    // 2. FILTROS OPCIONALES (Status y Country)
    if (status) query.status = status;
    if (country) query.country = country.toUpperCase(); // Aseguramos mayúsculas (CL, BO, etc.)

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 }) // Las más recientes primero
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('createdBy', 'name email'); // Útil para que el admin vea quién la hizo

    const count = await Transaction.countDocuments(query);

    res.json({
      ok: true,
      transactions: transactions, // Estandarizamos a 'transactions' o 'data' según uses en FE
      data: transactions,         // Enviamos ambos para compatibilidad
      total: count,
      totalPages: Math.ceil(count / limit),
      currentPage: Number(page)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: 'Error al obtener historial' });
  }
});

// GET /api/transactions/:id
// Detalle individual con seguridad
router.get('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;

    const tx = await Transaction.findById(id).populate('createdBy', 'name email');

    if (!tx) {
      return res.status(404).json({ ok: false, error: 'Transacción no encontrada.' });
    }

    // Seguridad: Solo el dueño o un Admin pueden ver el detalle
    const isOwner = tx.createdBy._id.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ ok: false, error: 'No autorizado.' });
    }

    res.json({ ok: true, data: tx });
  } catch (error) {
    console.error('Error tx detail:', error);
    if (error.kind === 'ObjectId') return res.status(404).json({ ok: false, error: 'ID inválido.' });
    res.status(500).json({ ok: false, error: 'Error del servidor.' });
  }
});

export default router;