import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js'; // Importamos el modelo User
import { jwtSecret, jwtExpiresIn } from '../config/env.js'; // Importamos la configuración del token

const router = Router();

// --- Registro de Nuevo Usuario con Verificación ---
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    // 1. Validaciones básicas (sin cambios)
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

    // 2. Crear instancia del nuevo usuario
    const newUser = new User({ name, email, password });

    // 3. Generar el token de verificación de email
    const verificationToken = newUser.generateEmailVerificationToken();
    // En este punto, newUser ya tiene emailVerificationToken (hash) y emailVerificationExpires

    // 4. Guardar el usuario en la BD (esto hashea la contraseña y guarda el token)
    await newUser.save();

    // 5. Enviar el correo de verificación
    try {
      // Construye la URL de verificación (asegúrate que FRONTEND_URL esté en tus .env)
      const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
      
      const message = `
        <p>¡Bienvenido a AVF Remesas!</p>
        <p>Por favor, haz clic en el siguiente enlace para verificar tu dirección de correo electrónico:</p>
        <p><a href="${verificationUrl}" target="_blank">Verificar mi correo</a></p>
        <p>Si no te registraste en AVF Remesas, por favor ignora este mensaje.</p>
        <p>Este enlace expirará en 10 minutos.</p>
      `;

      await sendEmail({
        to: newUser.email,
        subject: 'Verificación de Correo Electrónico - AVF Remesas',
        text: `Por favor, verifica tu correo copiando y pegando este enlace en tu navegador: ${verificationUrl}`,
        html: message,
      });

      console.log(`[auth/register] Correo de verificación enviado a ${newUser.email}`);
    } catch (emailError) {
      console.error(`[auth/register] Fallo al enviar correo de verificación a ${newUser.email}:`, emailError);
      // Decide si quieres fallar el registro completo o solo loguear el error de email
      // Por ahora, solo logueamos, el usuario está creado pero no verificado.
    }

    // 6. Respuesta exitosa indicando que se envió el correo
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
// --- Inicio de Sesión ---
// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Validaciones básicas
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Correo y contraseña son obligatorios.' });
    }

    // 2. Buscar al usuario por email (insensible a mayúsculas/minúsculas)
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Mensaje genérico para no dar pistas sobre si el email existe o no
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas.' });
    }

    // 3. Comparar la contraseña ingresada con la hasheada usando el método del modelo
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas.' });
    }

    // 4. Si las credenciales son correctas, generar el Token JWT
    const payload = {
      userId: user._id, // Identificador único del usuario
      name: user.name,
      role: user.role // Incluimos el rol en el token
    };

    const token = jwt.sign(
      payload,
      jwtSecret, // La clave secreta para firmar el token
      { expiresIn: jwtExpiresIn } // Tiempo de expiración (ej: '1d', '8h')
    );

    // 5. Respuesta exitosa: enviamos el token y datos básicos del usuario
    res.json({
      ok: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role // Enviamos el rol al frontend
      },
    });

  } catch (error) {
    console.error('[auth/login] Error:', error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor al iniciar sesión.' });
  }
});

export default router;