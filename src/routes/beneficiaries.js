import { Router } from 'express';
import Beneficiary from '../models/Beneficiary.js';
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

// GET /api/beneficiaries - Listar todos los beneficiarios del usuario autenticado
router.get('/', protect, async (req, res) => {
  try {
    // Busca beneficiarios donde el campo 'user' coincida con el ID del usuario autenticado
    const beneficiaries = await Beneficiary.find({ user: req.user._id });
    res.json({ ok: true, beneficiaries });
  } catch (error) {
    console.error('[beneficiaries] Error al listar:', error);
    res.status(500).json({ ok: false, error: 'Error al listar beneficiarios.' });
  }
});

// POST /api/beneficiaries - Crear un nuevo beneficiario favorito
router.post('/', protect, async (req, res) => {
  const { nickname, country, beneficiaryData } = req.body;

  try {
    // 1. Validaciones mínimas
    if (!nickname || !country || !beneficiaryData) {
      return res.status(400).json({ ok: false, error: 'Faltan datos requeridos (nickname, country, beneficiaryData).' });
    }

    // 2. Crear el nuevo documento asociado al usuario logueado
    const newBeneficiary = await Beneficiary.create({
      user: req.user._id, // Asigna el beneficiario al usuario autenticado (requiere que el token sea válido)
      nickname,
      country,
      beneficiaryData: beneficiaryData,
    });

    res.status(201).json({ ok: true, beneficiary: newBeneficiary });
  } catch (error) {
    console.error('[beneficiaries] Error al crear:', error);
    // Manejo de error si el nickname ya existe (código 11000 de MongoDB)
    if (error.code === 11000) {
      return res.status(400).json({ ok: false, error: 'Ya existe un favorito con ese nombre.' });
    }
    res.status(500).json({ ok: false, error: 'Error al guardar beneficiario.' });
  }
});

// DELETE /api/beneficiaries/:id - Eliminar un beneficiario
router.delete('/:id', protect, async (req, res) => {
  try {
    // Busca y elimina asegurando que el ID coincida con el usuario autenticado
    const beneficiary = await Beneficiary.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id, // Solo puede borrar sus propios beneficiarios
    });

    if (!beneficiary) {
      return res.status(404).json({ ok: false, error: 'Beneficiario no encontrado o no pertenece a este usuario.' });
    }

    res.json({ ok: true, message: 'Beneficiario eliminado.' });
  } catch (error) {
    console.error('[beneficiaries] Error al eliminar:', error);
    res.status(500).json({ ok: false, error: 'Error al eliminar beneficiario.' });
  }
});

// PUT /api/beneficiaries/:id - Actualizar un beneficiario (Solo nickname por ahora para simplificar)
router.put('/:id', protect, async (req, res) => {
  const { nickname } = req.body; // Podríamos permitir editar beneficiaryData, pero es complejo validar
  try {
    const beneficiary = await Beneficiary.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { nickname },
      { new: true }
    );

    if (!beneficiary) return res.status(404).json({ ok: false, error: 'No encontrado.' });
    res.json({ ok: true, beneficiary });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error al actualizar.' });
  }
});

export default router;