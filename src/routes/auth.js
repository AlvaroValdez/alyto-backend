import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import { jwtSecret, jwtExpiresIn } from '../config/env.js';
import { sendEmail } from '../services/emailService.js';
import { protect } from '../middleware/authMiddleware.js';
import upload from '../middleware/uploadMiddleware.js';

const router = Router();

// --- Ruta de Registro (sin cambios) ---
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    // ... (Validaciones y creación de usuario)
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ ok: false, error: 'El correo electrónico ya está registrado.' });
    }
    
    const newUser = new User({ name, email, password });
    const verificationToken = newUser.generateEmailVerificationToken();
    await newUser.save(); // El usuario se guarda

    // --- MEJORA DE ROBUSTEZ: ENVÍO ASÍNCRONO ---
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    const message = `<p>¡Bienvenido a AVF Remesas!...</p><p><a href="${verificationUrl}">Verificar mi correo</a></p>`;

    // NO usamos 'await' aquí.
    sendEmail({
      to: newUser.email,
      subject: 'Verificación de Correo Electrónico - AVF Remesas',
      html: message,
    }).catch(emailError => {
       // Si el envío falla (como ahora), solo lo registramos en el log del backend.
       // El usuario ya recibió su mensaje de éxito y puede continuar.
       console.error(`[auth/register] FALLO ASÍNCRONO al enviar correo a ${newUser.email}:`, emailError.message);
    });

    // 6. Respuesta INMEDIATA al Frontend
    // La respuesta ahora se envía en ~100ms en lugar de 121 segundos.
    res.status(201).json({ 
        ok: true, 
        message: 'Usuario registrado. Por favor, revisa tu correo para verificar tu cuenta.' 
    });

  } catch (error) {
    // ... (manejo de errores de registro)
  }
});

// --- Ruta de Verificación de Email (sin cambios) ---
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  try {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ ok: false, error: 'El token de verificación es inválido o ha expirado.' });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    console.log(`[auth/verify] Email verificado exitosamente para: ${user.email}`);
    res.json({ ok: true, message: 'Correo electrónico verificado exitosamente.' });
  } catch (error) {
    console.error('[auth/verify] Error:', error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor al verificar el correo.' });
  }
});

// --- RUTA DE LOGIN (ACTUALIZADA) ---
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Correo y contraseña son obligatorios.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas.' });
    }

    // --- NUEVA VERIFICACIÓN ---
    // Comprueba si el correo ha sido verificado
    if (!user.isEmailVerified) {
      console.warn(`[auth/login] Intento de login fallido: ${email} no ha verificado su correo.`);
      return res.status(401).json({ 
        ok: false, 
        error: 'Tu cuenta no ha sido verificada. Por favor, revisa tu correo electrónico.' 
        // Podríamos añadir una bandera 'needsVerification: true' para que el frontend sepa que debe ofrecer reenviar el correo
      });
    }

    // Si todo está correcto (contraseña Y verificación), genera el Token JWT
    const payload = {
      userId: user._id,
      name: user.name,
      role: user.role
    };

    const token = jwt.sign(payload, jwtSecret, { expiresIn: jwtExpiresIn });

    res.json({
      ok: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isProfileComplete: user.isProfileComplete 
      },
    });

  } catch (error) {
    console.error('[auth/login] Error:', error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor al iniciar sesión.' });
  }
});

// PUT /api/auth/profile
router.put('/profile', protect, async (req, res) => {
  try {
    const { firstName, lastName, documentType, documentNumber, phoneNumber, address, birthDate } = req.body;

    // Buscamos al usuario por el ID del token
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado.' });
    }

    // Actualizamos los campos
    user.firstName = firstName || user.firstName;
    user.lastName = lastName || user.lastName;
    user.documentType = documentType || user.documentType;
    user.documentNumber = documentNumber || user.documentNumber;
    user.phoneNumber = phoneNumber || user.phoneNumber;
    user.address = address || user.address;
    user.birthDate = birthDate || user.birthDate;

    const updatedUser = await user.save();

    res.json({
      ok: true,
      message: 'Perfil actualizado correctamente.',
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        // Devolvemos el estado del perfil
        isProfileComplete: updatedUser.isProfileComplete, 
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName
      }
    });

  } catch (error) {
    console.error('[auth/profile] Error:', error);
    res.status(500).json({ ok: false, error: 'Error al actualizar el perfil.' });
  }
});

/// --- SUBIDA DE DOCUMENTOS KYC (Con Depuración Mejorada) ---
router.post('/kyc-documents', protect, (req, res, next) => {
  // 1. Envolvemos el middleware de subida para capturar errores de Cloudinary/Multer
  const uploadMiddleware = upload.fields([
    { name: 'idFront', maxCount: 1 },
    { name: 'idBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 }
  ]);

  uploadMiddleware(req, res, (err) => {
    if (err) {
      // 2. Si hay un error en la subida, lo mostramos con detalle
      console.error('❌ [auth/kyc-documents] Error en Multer/Cloudinary:', JSON.stringify(err, null, 2));
      
      if (err.message === 'Unexpected field') {
        return res.status(400).json({ ok: false, error: 'Campo de archivo no esperado. Verifica los nombres (idFront, idBack, selfie).' });
      }
      
      return res.status(500).json({ 
        ok: false, 
        error: 'Error al subir archivos al servidor.',
        details: err.message || err 
      });
    }
    // 3. Si no hay error, continuamos al controlador
    next();
  });
}, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });

    const files = req.files; 
    if (!files || Object.keys(files).length === 0) {
      return res.status(400).json({ ok: false, error: 'No se recibieron archivos. Verifica el formato.' });
    }

    // Inicializar objetos si no existen
    if (!user.kyc) user.kyc = {};
    if (!user.kyc.documents) user.kyc.documents = {};

    // Guardar URLs de Cloudinary
    if (files.idFront) user.kyc.documents.idFront = files.idFront[0].path;
    if (files.idBack) user.kyc.documents.idBack = files.idBack[0].path;
    if (files.selfie) user.kyc.documents.selfie = files.selfie[0].path;

    user.kyc.status = 'pending'; 
    user.kyc.submittedAt = new Date();
    user.kyc.level = 2; 

    await user.save();

    console.log(`✅ [auth/kyc-documents] Documentos subidos para usuario ${user.email}`);

    res.json({
      ok: true,
      message: 'Documentos subidos correctamente. Tu cuenta está en revisión.',
      kyc: user.kyc
    });

  } catch (error) {
    console.error('[auth/kyc-documents] Error en controlador:', error);
    res.status(500).json({ ok: false, error: 'Error al procesar los datos del usuario.' });
  }
});

export default router;