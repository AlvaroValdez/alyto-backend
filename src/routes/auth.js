import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import { jwtSecret, jwtExpiresIn } from '../config/env.js';
import { sendEmail } from '../services/emailService.js';
import { protect } from '../middleware/authMiddleware.js';
import upload from '../middleware/uploadMiddleware.js';

const router = Router();

// --- REGISTRO DE USUARIO ---
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    // 1. Validaciones
    if (!name || !email || !password) {
      return res.status(400).json({ ok: false, error: 'Todos los campos son obligatorios.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ ok: false, error: 'El correo electrónico ya está registrado.' });
    }

    // 2. Crear usuario
    const newUser = new User({ name, email, password });
    const verificationToken = newUser.generateEmailVerificationToken();
    await newUser.save();

    // 3. Enviar correo (Asíncrono - No bloqueante)
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    const message = `
      <p>¡Bienvenido a AVF Remesas!</p>
      <p>Por favor, haz clic en el siguiente enlace para verificar tu cuenta:</p>
      <p><a href="${verificationUrl}" target="_blank">Verificar mi correo</a></p>
      <p>Este enlace expirará en 10 minutos.</p>
    `;

    sendEmail({
      to: newUser.email,
      subject: 'Verificación de Correo Electrónico - AVF Remesas',
      html: message,
    }).catch(err => console.error('[auth/register] Error envío email:', err.message));

    res.status(201).json({ 
        ok: true, 
        message: 'Usuario registrado. Por favor, revisa tu correo para verificar tu cuenta.' 
    });

  } catch (error) {
    console.error('[auth/register] Error:', error);
    if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map(val => val.message);
        return res.status(400).json({ ok: false, error: messages.join(', ') });
    }
    res.status(500).json({ ok: false, error: 'Error interno del servidor al registrar.' });
  }
});

// --- VERIFICACIÓN DE EMAIL ---
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ ok: false, error: 'Token no proporcionado.' });

  try {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ ok: false, error: 'Token inválido o expirado.' });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    res.json({ ok: true, message: 'Correo verificado exitosamente.' });
  } catch (error) {
    console.error('[auth/verify] Error:', error);
    res.status(500).json({ ok: false, error: 'Error al verificar el correo.' });
  }
});

// --- INICIO DE SESIÓN ---
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Correo y contraseña son obligatorios.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas.' });
    }

    if (!user.isEmailVerified) {
      return res.status(401).json({ ok: false, error: 'Tu cuenta no ha sido verificada. Revisa tu correo.' });
    }

    const payload = { userId: user._id, name: user.name, role: user.role };
    const token = jwt.sign(payload, jwtSecret, { expiresIn: jwtExpiresIn });

    res.json({
      ok: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isProfileComplete: user.isProfileComplete,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber,
        address: user.address,
        documentType: user.documentType,
        documentNumber: user.documentNumber,
        // ✅ CORRECCIÓN: Se devuelve el objeto KYC completo
        kyc: user.kyc 
      },
    });

  } catch (error) {
    console.error('[auth/login] Error:', error);
    res.status(500).json({ ok: false, error: 'Error interno al iniciar sesión.' });
  }
});

// --- ACTUALIZAR PERFIL (KYC Nivel 1) ---
router.put('/profile', protect, async (req, res) => {
  try {
    const { firstName, lastName, documentType, documentNumber, phoneNumber, address, birthDate } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ ok: false, error: 'Usuario no encontrado.' });

    // Actualizamos campos si vienen en el body
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (documentType) user.documentType = documentType;
    if (documentNumber) user.documentNumber = documentNumber;
    if (phoneNumber) user.phoneNumber = phoneNumber;
    if (address) user.address = address;
    if (birthDate) user.birthDate = birthDate;

    // El middleware pre-save actualizará isProfileComplete automáticamente
    const updatedUser = await user.save();

    res.json({
      ok: true,
      message: 'Perfil actualizado correctamente.',
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        isProfileComplete: updatedUser.isProfileComplete,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        phoneNumber: updatedUser.phoneNumber,
        address: updatedUser.address,
        documentType: updatedUser.documentType,
        documentNumber: updatedUser.documentNumber,
        // ✅ CORRECCIÓN: Se devuelve el objeto KYC para no perder el estado
        kyc: updatedUser.kyc 
      }
    });

  } catch (error) {
    console.error('[auth/profile] Error:', error);
    res.status(500).json({ ok: false, error: 'Error al actualizar el perfil.' });
  }
});

// --- SUBIDA DE DOCUMENTOS KYC (Nivel 2) ---
router.post('/kyc-documents', protect, (req, res, next) => {
  const uploadMiddleware = upload.fields([
    { name: 'idFront', maxCount: 1 },
    { name: 'idBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 }
  ]);

  uploadMiddleware(req, res, (err) => {
    if (err) {
      console.error('❌ [auth/kyc-documents] Error Multer:', JSON.stringify(err, null, 2));
      if (err.message === 'Unexpected field') {
        return res.status(400).json({ ok: false, error: 'Campos de archivo inválidos.' });
      }
      return res.status(500).json({ ok: false, error: 'Error al subir archivos.', details: err.message || err });
    }
    next();
  });
}, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });

    const files = req.files; 
    if (!files || Object.keys(files).length === 0) {
      return res.status(400).json({ ok: false, error: 'No se recibieron archivos.' });
    }

    // Asegurar estructura
    if (!user.kyc) user.kyc = {};
    if (!user.kyc.documents) user.kyc.documents = {};

    // Guardar URLs
    if (files.idFront) user.kyc.documents.idFront = files.idFront[0].path;
    if (files.idBack) user.kyc.documents.idBack = files.idBack[0].path;
    if (files.selfie) user.kyc.documents.selfie = files.selfie[0].path;

    user.kyc.status = 'pending'; 
    user.kyc.submittedAt = new Date();
    user.kyc.level = 2; 

    await user.save();

    console.log(`✅ [auth/kyc-documents] Docs subidos para: ${user.email}`);

    res.json({
      ok: true,
      message: 'Documentos subidos correctamente. Cuenta en revisión.',
      kyc: user.kyc
    });

  } catch (error) {
    console.error('[auth/kyc-documents] Error:', error);
    res.status(500).json({ ok: false, error: 'Error al procesar documentos.' });
  }
});

// --- OLVIDÉ MI CONTRASEÑA ---
router.post('/forgotpassword', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ ok: false, error: 'No existe usuario con ese correo.' });

    const resetToken = user.getResetPasswordToken();
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
    const message = `
      <h3>Restablecer Contraseña</h3>
      <p>Haz clic aquí: <a href="${resetUrl}">${resetUrl}</a></p>
      <p>Expira en 10 minutos.</p>
    `;

    try {
      await sendEmail({ to: user.email, subject: 'Restablecer Contraseña - AVF', html: message });
      res.json({ ok: true, message: 'Correo enviado.' });
    } catch (err) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ ok: false, error: 'Error enviando correo.' });
    }
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error del servidor.' });
  }
});

// --- RESTABLECER CONTRASEÑA ---
router.put('/resetpassword/:resettoken', async (req, res) => {
  const { resettoken } = req.params;
  const { password } = req.body;

  try {
    const resetPasswordToken = crypto.createHash('sha256').update(resettoken).digest('hex');
    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) return res.status(400).json({ ok: false, error: 'Token inválido o expirado.' });

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.json({ ok: true, message: 'Contraseña actualizada.' });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error al restablecer contraseña.' });
  }
});

// --- SUBIR AVATAR ---
router.post('/avatar', protect, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se subió ninguna imagen.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ ok: false, error: 'Usuario no encontrado.' });

    // Guardar la URL de Cloudinary en el usuario
    user.avatar = req.file.path;
    await user.save();

    res.json({
      ok: true,
      message: 'Foto de perfil actualizada.',
      avatar: user.avatar // Devolvemos la nueva URL
    });

  } catch (error) {
    console.error('[auth/avatar] Error:', error);
    res.status(500).json({ ok: false, error: 'Error al actualizar la foto.' });
  }
});

export default router;