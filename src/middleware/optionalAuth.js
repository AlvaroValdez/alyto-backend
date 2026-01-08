import { protect } from './authMiddleware.js';

/**
 * Middleware opcional: intenta autenticar, pero SI FALLA y hay 'order' query, permite continuar
 * Esto permite consultas públicas de transacciones por Order ID
 */
export const optionalAuth = async (req, res, next) => {
    // Solo permitir sin auth si se consulta por 'order'
    const isOrderQuery = req.query.order;

    if (!isOrderQuery) {
        // Sin order query, requerir autenticación estricta
        return protect(req, res, next);
    }

    // Intentar autenticar, pero no fallar si no hay token
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer')) {
        // Hay token, intentar validarlo
        try {
            await protect(req, res, next);
        } catch (error) {
            // Token inválido pero es query pública, permitir continuar sin req.user
            console.log('[optionalAuth] Token inválido, permitiendo acceso público por order ID');
            next();
        }
    } else {
        // No hay token, permitir acceso público
        console.log('[optionalAuth] Acceso público permitido para consulta por order ID');
        next();
    }
};
