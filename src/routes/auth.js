import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js'; // Importamos el modelo
import { jwtSecret } from '../config/env.js'; // Necesitaremos añadir esto a env.js

const router = Router();

// --- Registro de Nuevo Usuario ---
// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    // 1. Validaciones básicas
    if (!name || !email || !password) {
      return res.status(400).json({ ok: false, error: 'Todos los campos son obligatorios.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    // 2. Verificar si el email ya existe
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ ok: false, error: 'El correo electrónico ya está registrado.' });
    }

    // 3. Crear el nuevo usuario (la contraseña se hashea automáticamente por el middleware del modelo)
    const newUser = new User({ name, email, password });
    await newUser.save();

    res.status(201).json({ ok: true, message: 'Usuario registrado exitosamente.' });

  } catch (error) {
    console.error('[auth/register] Error:', error);
    // Manejo de errores de validación de Mongoose
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

    // 2. Buscar al usuario por email
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas.' }); // Mensaje genérico por seguridad
    }

    // 3. Comparar contraseñas
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas.' }); // Mensaje genérico
    }

    // 4. Generar Token JWT
    const payload = {
      userId: user._id,
      name: user.name,
      // Podríamos añadir el rol aquí si lo tuviéramos: role: user.role
    };
    const token = jwt.sign(
      payload,
      jwtSecret, // Clave secreta para firmar el token
      { expiresIn: '1d' } // El token expira en 1 día
    );

    // 5. Respuesta exitosa con token y datos básicos del usuario
    res.json({
      ok: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        // role: user.role // Descomentar si añades roles
      },
    });

  } catch (error) {
    console.error('[auth/login] Error:', error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor al iniciar sesión.' });
  }
});

export default router;