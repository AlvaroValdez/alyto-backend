import { Router } from 'express';
import User from '../models/User.js';

const router = Router();

// GET /api/admin/kyc/pending
// Obtiene todos los usuarios que están esperando revisión
router.get('/pending', async (req, res) => {
  try {
    const users = await User.find({ 'kyc.status': 'pending' })
      .select('name email kyc createdAt') // Solo traemos los datos necesarios
      .sort({ 'kyc.submittedAt': 1 }); // Los más antiguos primero

    res.json({ ok: true, users });
  } catch (error) {
    console.error('[adminKyc] Error listando pendientes:', error);
    res.status(500).json({ ok: false, error: 'Error al obtener solicitudes pendientes.' });
  }
});

// PUT /api/admin/kyc/:userId/review
// Aprueba o rechaza una solicitud
router.put('/:userId/review', async (req, res) => {
  const { userId } = req.params;
  const { action, reason } = req.body; // action: 'approve' | 'reject'

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });

    if (action === 'approve') {
      user.kyc.status = 'approved';
      user.kyc.level = 2; // Sube de nivel
      user.kyc.verifiedAt = new Date();
      user.kyc.rejectionReason = null;
    } else if (action === 'reject') {
      user.kyc.status = 'rejected';
      user.kyc.rejectionReason = reason || 'Documentos no válidos.';
      // No cambiamos el nivel, se queda en el que estaba (probablemente 1)
    } else {
      return res.status(400).json({ ok: false, error: 'Acción inválida.' });
    }

    await user.save();

    // Aquí podrías enviar un email de notificación al usuario (Fase futura)

    res.json({ 
      ok: true, 
      message: `Solicitud ${action === 'approve' ? 'aprobada' : 'rechazada'} correctamente.`,
      user: { id: user._id, kyc: user.kyc }
    });

  } catch (error) {
    console.error('[adminKyc] Error procesando revisión:', error);
    res.status(500).json({ ok: false, error: 'Error al procesar la revisión.' });
  }
});

export default router;