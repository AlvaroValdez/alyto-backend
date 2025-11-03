import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import { jwtSecret, jwtExpiresIn } from '../config/env.js';
import { sendEmail } from '../services/emailService.js';

const router = Router();

// --- Ruta de Registro (sin cambios) ---
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ ok: false, error: 'El correo electrónico ya está registrado.' });
    }
    
    const newUser = new User({ name, email, password });
    const verificationToken = newUser.generateEmailVerificationToken();
    await newUser.save();

    // Enviar el correo de verificación
    try {
      const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
      const message = `<p>¡Bienvenido a AVF Remesas! Haz clic en el siguiente enlace para verificar tu cuenta:</p><p><a href="${verificationUrl}">Verificar mi correo</a></p><p>Este enlace expirará en 10 minutos.</p>`;
      await sendEmail({
        to: newUser.email,
        subject: 'Verificación de Correo Electrónico - AVF Remesas',
        html: message,
      });
    } catch (emailError) {
      console.error(`[auth/register] Fallo al enviar correo de verificación a ${newUser.email}:`, emailError);
    }

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
        role: user.role
      },
    });

  } catch (error) {
    console.error('[auth/login] Error:', error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor al iniciar sesión.' });
  }
});

export default router;