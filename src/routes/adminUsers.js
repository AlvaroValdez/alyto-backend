import { Router } from 'express';
import User from '../models/User.js';
// Importaremos el middleware isAdmin en el siguiente paso
// import { isAdmin } from '../middleware/authMiddleware.js'; 

const router = Router();

// GET /api/admin/users - Listar todos los usuarios
// Nota: Aplicaremos 'isAdmin' después de crearlo
router.get('/users', async (req, res) => {
  try {
    // Busca todos los usuarios, excluyendo el campo 'password'
    const users = await User.find().select('-password');
    res.json({ ok: true, users });
  } catch (error) {
    console.error('[adminUsers] Error listando usuarios:', error);
    res.status(500).json({ ok: false, error: 'Error al listar usuarios.' });
  }
});

// PUT /api/admin/users/:userId/role - Cambiar el rol de un usuario
// Nota: Aplicaremos 'isAdmin' después de crearlo
router.put('/users/:userId/role', async (req, res) => {
  const { userId } = req.params;
  const { role } = req.body; // Espera recibir { "role": "admin" } o { "role": "user" }

  try {
    // Validar el rol
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ ok: false, error: 'Rol inválido. Debe ser "user" o "admin".' });
    }

    // Buscar y actualizar el usuario
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { role: role },
      { new: true, runValidators: true } // Devuelve el documento actualizado y corre validaciones
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado.' });
    }

    res.json({ ok: true, message: `Rol de ${updatedUser.name} actualizado a ${updatedUser.role}.`, user: updatedUser });
  } catch (error) {
    console.error('[adminUsers] Error actualizando rol:', error);
    // Manejo específico si el ID no es válido para MongoDB
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ ok: false, error: 'ID de usuario inválido.' });
    }
    res.status(500).json({ ok: false, error: 'Error al actualizar el rol.' });
  }
});

// PUT /api/admin/users/:userId - Actualizar datos del perfil de un usuario (Admin)
router.put('/users/:userId', async (req, res) => {
  const { userId } = req.params;
  // Extraemos los campos permitidos para edición
  const {
    name, email,
    firstName, lastName,
    documentType, documentNumber,
    phoneNumber, address,
    isEmailVerified, isProfileComplete
  } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado.' });
    }

    // Actualización de campos si vienen en el body
    if (name) user.name = name;
    if (email) user.email = email; // Cuidado: cambiar email podría requerir re-verificación
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (documentType) user.documentType = documentType;
    if (documentNumber) user.documentNumber = documentNumber;
    if (phoneNumber) user.phoneNumber = phoneNumber;
    if (address) user.address = address;

    // El admin puede forzar la verificación
    if (isEmailVerified !== undefined) user.isEmailVerified = isEmailVerified;
    if (isProfileComplete !== undefined) user.isProfileComplete = isProfileComplete;

    await user.save();

    res.json({ ok: true, message: 'Usuario actualizado correctamente.', user });
  } catch (error) {
    console.error('[adminUsers] Error actualizando usuario:', error);
    res.status(500).json({ ok: false, error: 'Error al actualizar usuario.' });
  }
});

export default router;