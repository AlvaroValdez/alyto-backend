import { Router } from 'express';
import Transaction from '../models/Transaction.js';
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

// GET /api/transactions
// Obtener historial del usuario actual
router.get('/', protect, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    // Filtro: El usuario solo ve sus propias transacciones
    const query = { createdBy: req.user._id };

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Transaction.countDocuments(query);

    res.json({
      ok: true,
      data: transactions, // El frontend espera 'data' o 'transactions' según tu implementación, ajustado a 'data' por estándar
      totalPages: Math.ceil(count / limit),
      currentPage: page
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: 'Error al obtener historial' });
  }
});

// GET /api/transactions/:id
// Obtener detalle de una transacción específica
router.get('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar transacción
    const tx = await Transaction.findById(id).populate('createdBy', 'name email');

    if (!tx) {
      return res.status(404).json({ ok: false, error: 'Transacción no encontrada en el sistema.' });
    }

    // Seguridad: Verificar que la transacción pertenezca al usuario (o que sea Admin)
    const isOwner = tx.createdBy._id.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ ok: false, error: 'No tienes permiso para ver esta transacción.' });
    }

    res.json({ ok: true, data: tx });
  } catch (error) {
    console.error('Error obteniendo transacción:', error);

    // Si el ID no es un ObjectId válido de Mongo
    if (error.kind === 'ObjectId') {
      return res.status(404).json({ ok: false, error: 'ID de transacción inválido.' });
    }

    res.status(500).json({ ok: false, error: 'Error del servidor al cargar el detalle.' });
  }
});

export default router;