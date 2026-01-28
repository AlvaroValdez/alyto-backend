import User from '../models/User.js';

/**
 * Middleware para rastrear la última actividad del usuario autenticado.
 * Se debe usar DESPUÉS del middleware 'protect' para que req.user esté disponible.
 * Actualiza el campo lastActivity en la base de datos sin bloquear la respuesta.
 */
export const trackActivity = async (req, res, next) => {
    if (req.user && req.user._id) {
        // Actualizar last activity de forma asíncrona (no bloqueante)
        // No esperamos la respuesta para no afectar el rendimiento
        User.findByIdAndUpdate(
            req.user._id,
            { lastActivity: new Date() },
            { new: false } // No necesitamos el documento actualizado
        ).catch(err => {
            // Log silencioso si falla, no queremos romper la petición
            console.error('[trackActivity] Error updating lastActivity:', err.message);
        });
    }

    next();
};
