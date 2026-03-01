import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * Rate limiters específicos para diferentes tipos de endpoints
 * Protección contra ataques de fuerza bruta y abuso de API
 */

/**
 * Rate limiter estricto para login
 * Previene ataques de fuerza bruta en credenciales
 */
export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // 5 intentos por ventana
    message: {
        ok: false,
        error: 'Demasiados intentos de inicio de sesión. Por favor, inténtalo nuevamente en 15 minutos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    ipv6Subnet: 64, // Fix para ERR_ERL_KEY_GEN_IPV6 proxy headers
    // Saltar rate limit para requests exitosos (opcional)
    skipSuccessfulRequests: false,
    // Log en caso de bloqueo
    handler: (req, res) => {
        console.warn(`[SECURITY] Login rate limit exceeded for IP: ${req['ip']}`);
        res.status(429).json({
            ok: false,
            error: 'Demasiados intentos de inicio de sesión. Por favor, inténtalo nuevamente en 15 minutos.'
        });
    }
});

/**
 * Rate limiter para registro de usuarios
 * Previene creación masiva de cuentas (spam/fraude)
 */
export const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 3, // 3 registros por hora por IP
    message: {
        ok: false,
        error: 'Demasiados intentos de registro. Por favor, inténtalo nuevamente más tarde.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    ipv6Subnet: 64, // Fix para ERR_ERL_KEY_GEN_IPV6 proxy headers
    handler: (req, res) => {
        console.warn(`[SECURITY] Register rate limit exceeded for IP: ${req['ip']}`);
        res.status(429).json({
            ok: false,
            error: 'Has alcanzado el límite de registros por hora. Intenta nuevamente más tarde.'
        });
    }
});

/**
 * Rate limiter para recuperación de contraseña
 * Previene spam de emails de recuperación
 */
export const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 3, // 3 intentos por ventana
    message: {
        ok: false,
        error: 'Demasiadas solicitudes de recuperación de contraseña. Intenta en 15 minutos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    ipv6Subnet: 64, // Fix para ERR_ERL_KEY_GEN_IPV6 proxy headers
    handler: (req, res) => {
        console.warn(`[SECURITY] Password reset rate limit exceeded for IP: ${req['ip']}`);
        res.status(429).json({
            ok: false,
            error: 'Has excedido el límite de solicitudes de recuperación de contraseña.'
        });
    }
});

/**
 * Rate limiter para transacciones/retiros
 * Previene transacciones masivas sospechosas
 */
export const transactionLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 20, // 20 transacciones por hora por usuario
    message: {
        ok: false,
        error: 'Has alcanzado el límite de transacciones por hora. Por favor, intenta más tarde.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    ipv6Subnet: 64, // Fix para ERR_ERL_KEY_GEN_IPV6 proxy headers
    // Identificar por usuario autenticado (no solo IP)
    keyGenerator: (req) => {
        if (req.user && req.user._id) {
            return `user_${req.user._id}`;
        }
        // Obfuscate to prevent express-rate-limit regex from throwing ERR_ERL_KEY_GEN_IPV6
        const clientIp = req['ip'];
        return ipKeyGenerator(clientIp, 64);
    },
    // Omitir rate limit en desarrollo
    skip: (req) => process.env.NODE_ENV === 'development',
    handler: (req, res) => {
        const identifier = req.user?._id || req['ip'];
        console.warn(`[SECURITY] Transaction rate limit exceeded for: ${identifier}`);
        res.status(429).json({
            ok: false,
            error: 'Has excedido el límite de transacciones por hora. Si necesitas realizar más operaciones, contacta a soporte.'
        });
    }
});

/**
 * Rate limiter para admin treasury approvals
 * Solo aplica si hay actividad sospechosa masiva
 */
export const adminTreasuryLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutos
    max: 50, // 50 aprobaciones por ventana (muy permisivo para admin)
    message: {
        ok: false,
        error: 'Demasiadas aprobaciones en corto tiempo. Pausa y continúa en unos minutos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    ipv6Subnet: 64, // Fix para ERR_ERL_KEY_GEN_IPV6 proxy headers
    keyGenerator: (req) => {
        const clientIp = req['ip'];
        return req.user?._id ? `admin_${req.user._id}` : ipKeyGenerator(clientIp, 64);
    },
    skip: (req) => process.env.NODE_ENV === 'development',
    handler: (req, res) => {
        console.warn(`[SECURITY] Admin treasury rate limit exceeded for: ${req.user?._id || req['ip']}`);
        res.status(429).json({
            ok: false,
            error: 'Has excedido el límite de aprobaciones. Pausa brevemente.'
        });
    }
});

/**
 * Rate limiter muy estricto para KYC document uploads
 * Previene spam de documentos
 */
export const kycUploadLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 horas
    max: 10, // 10 uploads por día (permite algunos reintentos)
    message: {
        ok: false,
        error: 'Has alcanzado el límite diario de subida de documentos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    ipv6Subnet: 64, // Fix para ERR_ERL_KEY_GEN_IPV6 proxy headers
    keyGenerator: (req) => {
        const clientIp = req['ip'];
        return req.user?._id || ipKeyGenerator(clientIp, 64);
    },
    handler: (req, res) => {
        console.warn(`[SECURITY] KYC upload rate limit exceeded for: ${req.user?._id || req['ip']}`);
        res.status(429).json({
            ok: false,
            error: 'Has alcanzado el límite diario de subida de documentos. Si tienes problemas, contacta a soporte.'
        });
    }
});

/**
 * Rate limiter general para API (menos estricto)
 * Ya existe en app.js pero aquí está documentado
 */
export const generalApiLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutos
    max: 100, // 100 requests por ventana
    message: {
        ok: false,
        error: 'Demasiadas peticiones. Por favor, reduce la frecuencia.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    ipv6Subnet: 64, // Fix para ERR_ERL_KEY_GEN_IPV6 proxy headers
});

export default {
    loginLimiter,
    registerLimiter,
    passwordResetLimiter,
    transactionLimiter,
    adminTreasuryLimiter,
    kycUploadLimiter,
    generalApiLimiter
};
