import { Router } from 'express';
import User from '../models/User.js';
import { notifyKycResult, notifyAdminNewKyc } from '../services/notificationService.js';
import { fireSep12Callback } from '../services/sep12CallbackService.js';


const router = Router();

// GET /api/admin/kyc/pending
// Obtiene todos los usuarios que están esperando revisión
router.get('/pending', async (req, res) => {
  try {
    const users = await User.find({ 'kyc.status': { $in: ['pending', 'review'] } })
      .select('name email kyc accountType createdAt') // Incluimos accountType
      .sort({ 'kyc.submittedAt': 1 });

    res.json({ ok: true, users });
  } catch (error) {
    console.error('[adminKyc] Error listando pendientes:', error);
    res.status(500).json({ ok: false, error: 'Error al obtener solicitudes pendientes.' });
  }
});

// GET /api/admin/kyc/:userId
// Obtiene el detalle completo de KYC/KYB de un usuario
router.get('/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('name email kyc business accountType documentType documentNumber firstName lastName phoneNumber address birthDate');
    if (!user) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    res.json({ ok: true, user });
  } catch (error) {
    console.error('[adminKyc] Error obteniendo detalle:', error);
    res.status(500).json({ ok: false, error: 'Error al obtener detalle del usuario.' });
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

    // 🔔 Push notification al usuario
    notifyKycResult(user, action === 'approve', reason).catch(() => { });

    // 🌐 SEP-12 callback al wallet Stellar (si tiene URL registrada)
    fireSep12Callback(user, action, reason).catch(() => { });


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