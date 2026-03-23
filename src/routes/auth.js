import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import { jwtSecret, jwtExpiresIn } from '../config/env.js';
import { sendEmail, getVerificationEmailTemplate } from '../services/emailService.js';
import { protect } from '../middleware/authMiddleware.js';
import upload from '../middleware/uploadMiddleware.js';
import { notifyAdminNewUser, notifyWelcomeUser, notifyAdminNewKyc, notifyKycDocsReceived } from '../services/notificationService.js';
import { notifyUser, sendPushNotification } from '../services/fcmService.js';
import {
  loginLimiter,
  registerLimiter,
  passwordResetLimiter,
  kycUploadLimiter
} from '../middleware/rateLimiters.js';

const router = Router();

// --- REGISTRO DE USUARIO ---
router.post('/register', registerLimiter, async (req, res) => {
  const { name, email, password, accountType, registrationCountry } = req.body;

  try {
    // 1. Validaciones
    if (!name || !email || !password) {
      return res.status(400).json({ ok: false, error: 'Todos los campos son obligatorios.' });
    }
    // --- VALIDACIÓN DE SEGURIDAD (Password Policy) ---
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@._$!%*?&])[A-Za-z\d@._$!%*?&]{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        ok: false,
        error: 'La contraseña debe tener al menos 8 caracteres, incluir mayúsculas, minúsculas, números y al menos un carácter especial (@._$!%*?&).'
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ ok: false, error: 'El correo electrónico ya está registrado.' });
    }

    // --- VALIDACIÓN DE CONTRATO (COMPLIANCE) ---
    const { contractAccepted, contractVersion, deviceFingerprint } = req.body;

    // Si no acepta el contrato, no puede registrarse (Bloqueo Legal)
    if (contractAccepted !== true) {
      const errorMsg = registrationCountry === 'BO'
        ? 'Debes aceptar el Contrato de Mandato y Declaración de Origen de Fondos para continuar.'
        : 'Debes aceptar los Términos y Condiciones de Uso para continuar.';
      return res.status(400).json({ ok: false, error: errorMsg });
    }

    // Obtener IP del cliente
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // 2. Crear usuario
    const newUser = new User({
      name,
      email,
      password,
      accountType: accountType || 'individual',
      registrationCountry: registrationCountry || 'BO',
      contractAcceptance: {
        accepted: true,
        version: contractVersion || 'v1.0',
        acceptedAt: new Date(),
        ipAddress: ipAddress,
        deviceFingerprint: deviceFingerprint || 'unknown'
      }
    });
    const verificationToken = newUser.generateEmailVerificationToken();
    await newUser.save();

    // 3. Enviar correo (Con validación de éxito)
    // Nunca usar localhost en producción — si la var no apunta a producción, usamos el dominio real
    const rawFrontendUrl = process.env.FRONTEND_URL || '';
    const frontendUrl = rawFrontendUrl.includes('localhost')
      ? 'https://avf-vita-fe10.onrender.com'
      : rawFrontendUrl;
    const verificationUrl = `${frontendUrl}/verify-email?token=${verificationToken}`;
    const htmlMessage = getVerificationEmailTemplate(verificationUrl, newUser.name);
    // Intentar enviar email y manejar fallos
    let emailSent = true;
    try {
      const emailResult = await sendEmail({
        to: newUser.email,
        subject: '✅ Verifica tu cuenta en Alyto',
        html: htmlMessage,
      });

      if (!emailResult.success) {
        emailSent = false;
        console.error('[auth/register] ⚠️ Email no enviado, pero usuario creado');
      }
    } catch (err) {
      emailSent = false;
      console.error('[auth/register] ❌ Error enviando email:', err.message);
    }

    // Respuesta diferenciada según éxito de email
    if (emailSent) {
      // 🔔 A7 — Notificar admins: nuevo usuario registrado
      notifyAdminNewUser(newUser).catch(() => { });
      // 🔔 U15 — Notificar usuario: bienvenida
      notifyWelcomeUser(newUser._id).catch(() => { });

      res.status(201).json({
        ok: true,
        message: 'Usuario registrado. Por favor, revisa tu correo para verificar tu cuenta.',
        emailSent: true
      });
    } else {
      // 🔔 A7 — Notificar admins: nuevo usuario registrado
      notifyAdminNewUser(newUser).catch(() => { });
      // 🔔 U15 — Notificar usuario: bienvenida
      notifyWelcomeUser(newUser._id).catch(() => { });

      res.status(201).json({
        ok: true,
        message: 'Usuario registrado, pero hubo un problema enviando el email de verificación. Por favor, contacta a soporte para verificar tu cuenta.',
        emailSent: false,
        warning: 'Email no enviado'
      });
    }

  } catch (error) {
    console.error('[auth/register] Error:', error);
    // MongoDB duplicate key — el email ya existe (race condition entre findOne y save)
    if (error.code === 11000) {
      return res.status(400).json({ ok: false, error: 'El correo electrónico ya está registrado.' });
    }
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

// --- VALIDACIÓN DE SESIÓN (Para timeout de inactividad) ---
/**
 * GET /api/auth/session-status
 * Verifica el estado de la sesión actual basado en la última actividad.
 * Retorna información sobre si la sesión está expirada o cuánto tiempo queda.
 */
router.get('/session-status', protect, (req, res) => {
  try {
    const SESSION_TIMEOUT_MS = Number(process.env.SESSION_TIMEOUT_MS) || 30 * 60 * 1000; // 30 minutos

    const lastActivity = req.user.lastActivity || req.user.updatedAt || new Date();
    const lastActivityTime = new Date(lastActivity).getTime();
    const currentTime = Date.now();
    const inactiveMs = currentTime - lastActivityTime;

    const isExpired = inactiveMs >= SESSION_TIMEOUT_MS;
    const timeRemaining = Math.max(0, SESSION_TIMEOUT_MS - inactiveMs);

    res.json({
      ok: true,
      isExpired,
      timeRemaining, // milliseconds hasta timeout
      lastActivity: lastActivity,
      sessionTimeout: SESSION_TIMEOUT_MS
    });
  } catch (error) {
    console.error('[auth/session-status] Error:', error);
    res.status(500).json({ ok: false, error: 'Error verificando estado de sesión.' });
  }
});

// --- INICIO DE SESIÓN ---
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Correo y contraseña requeridos.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    // --- VERIFICAR BLOQUEO DE CUENTA (Brute Force Protection) ---
    if (user && user.lockUntil && user.lockUntil > Date.now()) {
      const waitMinutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(403).json({
        ok: false,
        error: `Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intente nuevamente en ${waitMinutes} minutos.`
      });
    }

    if (!user || !(await user.comparePassword(password))) {
      // --- INCREMENTAR INTENTOS FALLIDOS ---
      if (user) {
        user.loginAttempts = (user.loginAttempts || 0) + 1;
        if (user.loginAttempts >= 5) {
          user.lockUntil = Date.now() + 15 * 60 * 1000; // Bloqueo de 15 minutos
        }
        await user.save();
      }
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas.' });
    }

    // --- RESETEAR INTENTOS SI EL LOGIN ES EXITOSO ---
    if (user.loginAttempts > 0 || user.lockUntil) {
      user.loginAttempts = 0;
      user.lockUntil = undefined;
    }

    // --- ACTUALIZAR ÚLTIMA ACTIVIDAD (Session Timeout) ---
    user.lastActivity = new Date();

    await user.save();

    if (!user.isEmailVerified) {
      return res.status(401).json({ ok: false, error: 'Cuenta no verificada.' });
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
        kyc: user.kyc,
        accountType: user.accountType,
        business: user.business,
        // --- CORRECCIÓN: ENVIAR AVATAR AL INICIAR SESIÓN ---
        avatar: user.avatar
      },
    });

  } catch (error) {
    console.error('[auth/login] Error:', error);
    res.status(500).json({ ok: false, error: 'Error interno al iniciar sesión.' });
  }
});

// --- RUTA DE PERFIL ---
router.put('/profile', protect, async (req, res) => {
  try {
    const { firstName, lastName, documentType, documentNumber, phoneNumber, address, birthDate } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ ok: false, error: 'Usuario no encontrado.' });

    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (documentType) user.documentType = documentType;
    if (documentNumber) user.documentNumber = documentNumber;
    if (phoneNumber) user.phoneNumber = phoneNumber;
    if (address) user.address = address;
    if (birthDate) user.birthDate = birthDate;

    // KYB fields
    if (req.body.accountType) user.accountType = req.body.accountType;
    if (req.body.business) {
      if (!user.business) user.business = {};
      const { name, taxId, registrationNumber, registeredAddress, countryCode, ubos } = req.body.business;
      if (name) user.business.name = name;
      if (taxId) user.business.taxId = taxId;
      if (registrationNumber) user.business.registrationNumber = registrationNumber;
      if (registeredAddress) user.business.registeredAddress = registeredAddress;
      if (countryCode) user.business.countryCode = countryCode;
      if (ubos) user.business.ubos = ubos;
    }

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
        kyc: updatedUser.kyc,
        accountType: updatedUser.accountType,
        business: updatedUser.business,
        // --- CORRECCIÓN: MANTENER EL AVATAR AL ACTUALIZAR PERFIL ---
        avatar: updatedUser.avatar
      }
    });

  } catch (error) {
    console.error('[auth/profile] Error:', error);
    res.status(500).json({ ok: false, error: 'Error al actualizar el perfil.' });
  }
});

// --- SUBIR AVATAR (SIN CAMBIOS, PERO CONFIRMAMOS QUE FUNCIONA) ---
router.post('/avatar', protect, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se subió ninguna imagen.' });
    }
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ ok: false, error: 'Usuario no encontrado.' });

    user.avatar = req.file.path;
    await user.save();

    res.json({
      ok: true,
      message: 'Foto de perfil actualizada.',
      avatar: user.avatar
    });
  } catch (error) {
    console.error('[auth/avatar] Error:', error);
    res.status(500).json({ ok: false, error: 'Error al actualizar la foto.' });
  }
});

// --- SUBIDA DE DOCUMENTOS KYC (Nivel 2) ---
router.post('/kyc-documents', protect, kycUploadLimiter, (req, res, next) => {
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

    // --- Datos personales obligatorios para KYC ---
    const birthDate = req.body.birthDate || user.birthDate;
    const address = req.body.address || user.address;
    const registrationCountry = req.body.registrationCountry || user.registrationCountry;

    const missing = [];
    if (!birthDate) missing.push('fecha de nacimiento');
    if (!address) missing.push('dirección');
    if (!registrationCountry) missing.push('país de registro');

    if (missing.length > 0) {
      return res.status(400).json({
        ok: false,
        error: `Faltan datos obligatorios para el KYC: ${missing.join(', ')}.`
      });
    }

    // Guardar datos personales si vienen en el request
    if (req.body.birthDate) user.birthDate = new Date(req.body.birthDate);
    if (req.body.address) user.address = req.body.address;
    if (req.body.registrationCountry) user.registrationCountry = req.body.registrationCountry;

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

    // 🔔 A3 — Notificar admins: nuevo KYC pendiente
    notifyAdminNewKyc(user).catch(() => { });
    // 🔔 U-KYC — Confirmar al usuario que sus docs fueron recibidos
    notifyKycDocsReceived(user).catch(() => { });

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

// --- SUBIDA DE DOCUMENTOS KYB (Empresas) ---
router.post('/kyb-documents', protect, kycUploadLimiter, (req, res, next) => {
  const uploadMiddleware = upload.fields([
    { name: 'incorporation', maxCount: 1 },
    { name: 'taxIdCard', maxCount: 1 },
    { name: 'repAuthorization', maxCount: 1 }
  ]);

  uploadMiddleware(req, res, (err) => {
    if (err) {
      console.error('❌ [auth/kyb-documents] Error Multer:', err);
      return res.status(400).json({ ok: false, error: 'Error al subir archivos empresariales.' });
    }
    next();
  });
}, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const files = req.files || {};

    if (!user.business) user.business = {};
    if (!user.business.documents) user.business.documents = {};

    if (files.incorporation) user.business.documents.incorporation = files.incorporation[0].path;
    if (files.taxIdCard) user.business.documents.taxIdCard = files.taxIdCard[0].path;
    if (files.repAuthorization) user.business.documents.repAuthorization = files.repAuthorization[0].path;

    user.kyc.status = 'pending';
    user.kyc.submittedAt = new Date();
    user.kyc.level = 2; // B2B también usa nivel 2 para documental

    await user.save();

    res.json({
      ok: true,
      message: 'Documentos empresariales subidos correctamente.',
      business: user.business,
      kyc: user.kyc
    });
  } catch (error) {
    console.error('[auth/kyb-documents] Error:', error);
    res.status(500).json({ ok: false, error: 'Error al procesar documentos KYB.' });
  }
});

// --- REENVÍO DE VERIFICACIÓN DE EMAIL ---
router.post('/resend-verification', passwordResetLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ ok: false, error: 'Correo requerido.' });

  try {
    const user = await User.findOne({ email: email.toLowerCase() });

    // Respuesta genérica para no revelar si el correo existe
    if (!user || user.isEmailVerified) {
      return res.json({ ok: true, message: 'Si el correo existe y no está verificado, recibirás un nuevo enlace.' });
    }

    const verificationToken = user.generateEmailVerificationToken();
    await user.save({ validateBeforeSave: false });

    const rawFrontendUrl = process.env.FRONTEND_URL || '';
    const frontendUrl = rawFrontendUrl.includes('localhost')
      ? 'https://avf-vita-fe10.onrender.com'
      : rawFrontendUrl;
    const verificationUrl = `${frontendUrl}/verify-email?token=${verificationToken}`;
    const htmlMessage = getVerificationEmailTemplate(verificationUrl, user.name);

    await sendEmail({
      to: user.email,
      subject: '✅ Verifica tu cuenta en Alyto',
      html: htmlMessage,
    });

    res.json({ ok: true, message: 'Si el correo existe y no está verificado, recibirás un nuevo enlace.' });
  } catch (error) {
    console.error('[auth/resend-verification] Error:', error);
    res.status(500).json({ ok: false, error: 'Error al reenviar el correo de verificación.' });
  }
});

// --- OLVIDÉ MI CONTRASEÑA ---
router.post('/forgotpassword', passwordResetLimiter, async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ ok: false, error: 'No existe usuario con ese correo.' });

    const resetToken = user.getResetPasswordToken();
    await user.save({ validateBeforeSave: false });

    const rawFrontendUrlPwd = process.env.FRONTEND_URL || '';
    const frontendUrlPwd = rawFrontendUrlPwd.includes('localhost')
      ? 'https://avf-vita-fe10.onrender.com'
      : rawFrontendUrlPwd;
    const resetUrl = `${frontendUrlPwd}/reset-password/${resetToken}`;
    const message = `
      <h3>Restablecer Contraseña</h3>
      <p>Haz clic aquí: <a href="${resetUrl}">${resetUrl}</a></p>
      <p>Expira en 10 minutos.</p>
    `;

    try {
      await sendEmail({ to: user.email, subject: 'Restablecer Contraseña - Alyto', html: message });
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

// PUT /api/auth/fcm-token — registrar token FCM del dispositivo
router.put('/fcm-token', protect, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ ok: false, error: 'token es requerido' });

    // Detectar si es el primer token del usuario (para enviar bienvenida)
    const existing = await User.findById(req.user._id).select('fcmToken');
    const isFirstToken = !existing?.fcmToken;

    await User.findByIdAndUpdate(req.user._id, { fcmToken: token, fcmTokenUpdatedAt: new Date() });

    // Enviar push de bienvenida la primera vez que el usuario registra un dispositivo
    if (isFirstToken) {
      sendPushNotification({
        token,
        title: '👋 ¡Bienvenido a Alyto!',
        body: 'Tu cuenta está lista. Completa tu perfil para empezar a enviar dinero.',
        data: { type: 'welcome' }
      }).catch(() => { });
    }

    res.json({ ok: true, message: 'FCM token registrado' });
  } catch (error) {
    console.error('[auth/fcm-token] Error:', error.message);
    res.status(500).json({ ok: false, error: 'Error registrando token' });
  }
});

// DELETE /api/auth/fcm-token — eliminar token al hacer logout
router.delete('/fcm-token', protect, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { $unset: { fcmToken: 1 } });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error eliminando token' });
  }
});

// GET /api/auth/test-push — Enviar push de prueba al usuario actual
router.get('/test-push', protect, async (req, res) => {
  try {
    console.log(`[test-push] Intentando enviar push de prueba a usuario: ${req.user.email}`);
    const result = await notifyUser(req.user._id, {
      title: '¡Campana Activa! 🔔',
      body: 'Tu dispositivo está recibiendo notificaciones push correctamente.',
      data: { type: 'test_ok', url: '/profile' }
    });

    if (result?.skipped) {
      return res.status(400).json({ ok: false, error: 'No tienes un token FCM registrado en la base de datos.' });
    }

    res.json({ ok: true, message: 'Push enviada, revisa tu dispositivo.', result });
  } catch (error) {
    console.error('[test-push] Error:', error);
    res.status(500).json({ ok: false, error: 'Error interno enviando push' });
  }
});

export default router;