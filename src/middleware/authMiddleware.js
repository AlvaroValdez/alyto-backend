import jwt from 'jsonwebtoken';
import { jwtSecret } from '../config/env.js';
import User from '../models/User.js';

/**
 * Middleware para verificar el token JWT y autenticar al usuario.
 * Si el token es válido, adjunta los datos del usuario (sin contraseña) a req.user.
 */
export const protect = async (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization;

  console.log('[authMiddleware] Verificando autorización...'); // Log inicial

  if (authHeader && authHeader.startsWith('Bearer')) {
    try {
      // Extrae el token: 'Bearer TOKEN_STRING' -> 'TOKEN_STRING'
      token = authHeader.split(' ')[1];
      console.log('[authMiddleware] Token extraído:', token ? 'Sí' : 'No'); // Verifica si se extrajo

      // --- LOGGING DETALLADO ---
      console.log('[authMiddleware] Intentando verificar token con secreto:', jwtSecret ? 'Secreto presente' : '¡SECRETO AUSENTE!'); 
      
      // Verifica el token
      const decoded = jwt.verify(token, jwtSecret);
      console.log('[authMiddleware] Token decodificado:', decoded); // Muestra el payload del token

      // Busca al usuario asociado al ID del token en la BD
      // .select('-password') excluye el campo de la contraseña del resultado
      req.user = await User.findById(decoded.userId).select('-password');
      console.log('[authMiddleware] Usuario encontrado:', req.user ? req.user.email : 'No encontrado');

      if (!req.user) {
         console.error('[authMiddleware] Usuario del token no existe en BD.');
         return res.status(401).json({ ok: false, error: 'Usuario no encontrado.' });
      }

      next(); // Pasa al siguiente
    } catch (error) {
      // --- LOGGING DE ERRORES ESPECÍFICO ---
      console.error('[authMiddleware] ¡ERROR DE TOKEN!', error); // Muestra el error completo de jwt.verify
      if (error.name === 'JsonWebTokenError') {
        res.status(401).json({ ok: false, error: 'Token inválido.' });
      } else if (error.name === 'TokenExpiredError') {
        res.status(401).json({ ok: false, error: 'Token expirado.' });
      } else {
        res.status(401).json({ ok: false, error: 'No autorizado.' });
      }
    }
  } else {
    console.warn('[authMiddleware] No se encontró cabecera Bearer.');
    res.status(401).json({ ok: false, error: 'No autorizado, no se proporcionó token.' });
  }
};