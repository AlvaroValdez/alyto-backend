import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js'; // Importamos el modelo User
import { jwtSecret, jwtExpiresIn } from '../config/env.js'; // Importamos la configuración del token

const router = Router();

// --- Registro de Nuevo Usuario ---
// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    // 1. Validaciones básicas de entrada
    if (!name || !email || !password) {
      return res.status(400).json({ ok: false, error: 'Nombre, correo y contraseña son obligatorios.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
    }
    // Podríamos añadir validación de formato de email aquí si el modelo no fuera suficiente

    // 2. Verificar si el correo electrónico ya existe en la base de datos
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ ok: false, error: 'El correo electrónico ya está registrado.' });
    }

    // 3. Crear el nuevo usuario
    // La contraseña se hasheará automáticamente gracias al middleware pre('save') en el modelo User.js
    const newUser = new User({ name, email, password });
    await newUser.save();

    // 4. Respuesta exitosa (no devolvemos datos sensibles)
    res.status(201).json({ ok: true, message: 'Usuario registrado exitosamente.' });

  } catch (error) {
    console.error('[auth/register] Error:', error);
    // Manejo específico para errores de validación de Mongoose (ej: email inválido)
    if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map(val => val.message);
        return res.status(400).json({ ok: false, error: messages.join(', ') });
    }
    // Error genérico para otros problemas
    res.status(500).json({ ok: false, error: 'Error interno del servidor al registrar el usuario.' });
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