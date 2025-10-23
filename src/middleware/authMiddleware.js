import jwt from 'jsonwebtoken';
import { jwtSecret } from '../config/env.js';
import User from '../models/User.js';

/**
 * Middleware para verificar el token JWT y autenticar al usuario.
 */
const protect = async (req, res, next) => {
  let token;

  // Busca el token en la cabecera 'Authorization' (formato: Bearer TOKEN)
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Extrae el token (quita 'Bearer ')
      token = req.headers.authorization.split(' ')[1];

      // Verifica el token usando la clave secreta
      const decoded = jwt.verify(token, jwtSecret);

      // Busca al usuario en la BD usando el ID del token (sin la contraseña)
      req.user = await User.findById(decoded.userId).select('-password');

      if (!req.user) {
         return res.status(401).json({ ok: false, error: 'Usuario no encontrado.' });
      }

      next(); // Si todo es correcto, pasa al siguiente middleware o a la ruta
    } catch (error) {
      console.error('[authMiddleware] Error de token:', error.message);
      res.status(401).json({ ok: false, error: 'No autorizado, token inválido o expirado.' });
    }
  }

  if (!token) {
    res.status(401).json({ ok: false, error: 'No autorizado, no se proporcionó token.' });
  }
};

// Podríamos añadir un middleware 'isAdmin' en el futuro
// const isAdmin = (req, res, next) => { ... };

export { protect };