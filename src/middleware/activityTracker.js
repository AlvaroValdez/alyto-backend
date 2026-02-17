import User from '../models/User.js';

/**
 * Middleware para rastrear la última actividad del usuario autenticado.
 * OPTIMIZADO: Solo actualiza si han pasado más de 1 minuto desde la última actualización
 * para reducir writes a la base de datos.
 * 
 * NOTA: Este middleware ya NO se usa globalmente para evitar overhead.
 * La actividad se actualiza principalmente en el login.
 * Si necesitas tracking más granular, aplícalo solo en rutas críticas.
 */

const UPDATE_THRESHOLD_MS = 60 * 1000; // Solo actualizar cada 1 minuto mínimo

export const trackActivity = async (req, res, next) => {
    if (req.user && req.user._id) {
        const lastActivity = req.user.lastActivity || new Date(0);
        const timeSinceLastUpdate = Date.now() - new Date(lastActivity).getTime();

        // Solo actualizar si ha pasado más de 1 minuto
        if (timeSinceLastUpdate > UPDATE_THRESHOLD_MS) {
            // Fire and forget - no bloquear la response
            User.findByIdAndUpdate(
                req.user._id,
                { lastActivity: new Date() },
                { new: false }
            ).catch(err => {
                // Silent log - no romper el request
                if (process.env.NODE_ENV === 'development') {
                    console.error('[trackActivity] Error:', err.message);
                }
            });
        }
    }

    next();
};
