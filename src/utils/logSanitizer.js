/**
 * Utilidades para sanitizar datos sensibles en logs
 * Evita la exposición de PII, API keys, tokens y otros datos confidenciales
 */

/**
 * Lista de campos sensibles que deben ser enmascarados
 */
const SENSITIVE_FIELDS = [
    // Autenticación y Tokens
    'password',
    'token',
    'accessToken',
    'refreshToken',
    'jwt',
    'apiKey',
    'api_key',
    'secret',
    'secretKey',
    'privateKey',
    'authorization',

    // Información Personal (PII)
    'email',
    'phone',
    'phoneNumber',
    'documentNumber',
    'document_number',
    'beneficiary_document_number',
    'ssn',
    'rut',

    // Información Financiera
    'accountNumber',
    'account_number',
    'cardNumber',
    'cvv',
    'pin',
    'bankAccount',

    // Vita API
    'x-trans-key',
    'x-api-key',
    'signature',
    'signatureBase',
    'resetPasswordToken',
    'emailVerificationToken'
];

/**
 * Patrones regex para detectar datos sensibles en strings
 */
const SENSITIVE_PATTERNS = [
    { name: 'JWT', regex: /eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g },
    { name: 'Email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
    { name: 'API Key', regex: /[a-f0-9]{32,}/gi },
    { name: 'Credit Card', regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g },
    { name: 'Phone', regex: /\+?\d{1,3}[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g }
];

/**
 * Enmascara un valor sensible
 * @param {any} value - Valor a enmascarar
 * @param {string} fieldName - Nombre del campo (opcional, para contexto)
 * @returns {string} Valor enmascarado
 */
const maskValue = (value, fieldName = '') => {
    if (value === null || value === undefined) return value;

    const str = String(value);
    const len = str.length;

    // Tokens largos: mostrar primeros y últimos 4 caracteres
    if (len > 20) {
        return `${str.substring(0, 4)}...${str.substring(len - 4)} [MASKED]`;
    }

    // Valores medianos: mostrar primeros 2 y últimos 2
    if (len > 8) {
        return `${str.substring(0, 2)}***${str.substring(len - 2)} [MASKED]`;
    }

    // Valores cortos: enmascarar completamente
    return '****** [MASKED]';
};

/**
 * Sanitiza un objeto recursivamente, enmascarando campos sensibles
 * @param {any} obj - Objeto a sanitizar
 * @param {number} depth - Profundidad actual (para evitar recursión infinita)
 * @returns {any} Objeto sanitizado
 */
export const sanitizeObject = (obj, depth = 0) => {
    // Límite de profundidad para evitar stack overflow
    if (depth > 10) return '[MAX_DEPTH_REACHED]';

    // Valores primitivos
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;

    // Arrays
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item, depth + 1));
    }

    // Objetos
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
        const keyLower = key.toLowerCase();

        // Verificar si el campo es sensible
        const isSensitive = SENSITIVE_FIELDS.some(field =>
            keyLower.includes(field.toLowerCase())
        );

        if (isSensitive) {
            sanitized[key] = maskValue(value, key);
        } else if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitizeObject(value, depth + 1);
        } else {
            sanitized[key] = value;
        }
    }

    return sanitized;
};

/**
 * Sanitiza una cadena de texto, enmascarando patrones sensibles
 * @param {string} text - Texto a sanitizar
 * @returns {string} Texto sanitizado
 */
export const sanitizeString = (text) => {
    if (typeof text !== 'string') return text;

    let sanitized = text;

    // Aplicar cada patrón
    SENSITIVE_PATTERNS.forEach(({ name, regex }) => {
        sanitized = sanitized.replace(regex, (match) => {
            const len = match.length;
            if (len > 10) {
                return `${match.substring(0, 3)}...${match.substring(len - 3)} [${name}]`;
            }
            return `***[${name}]`;
        });
    });

    return sanitized;
};

/**
 * Logger seguro que sanitiza automáticamente los datos
 */
export const secureLog = {
    /**
     * Log de información (sanitizado)
     */
    info: (message, data = null) => {
        if (data) {
            console.log(message, sanitizeObject(data));
        } else {
            console.log(message);
        }
    },

    /**
     * Log de error (sanitizado)
     */
    error: (message, error = null) => {
        if (error) {
            // Sanitizar el error pero mantener el stack trace (sin datos sensibles)
            const sanitizedError = {
                message: error.message,
                name: error.name,
                stack: error.stack ? sanitizeString(error.stack) : undefined,
                ...sanitizeObject(error)
            };
            console.error(message, sanitizedError);
        } else {
            console.error(message);
        }
    },

    /**
     * Log de advertencia (sanitizado)
     */
    warn: (message, data = null) => {
        if (data) {
            console.warn(message, sanitizeObject(data));
        } else {
            console.warn(message);
        }
    },

    /**
     * Log de debug (sanitizado, solo en desarrollo)
     */
    debug: (message, data = null) => {
        if (process.env.NODE_ENV === 'development') {
            if (data) {
                console.log(`[DEBUG] ${message}`, sanitizeObject(data));
            } else {
                console.log(`[DEBUG] ${message}`);
            }
        }
    }
};

/**
 * Middleware Express para sanitizar logs de requests/responses
 */
export const requestLogSanitizer = (req, res, next) => {
    const originalJson = res.json;

    // Interceptar res.json para sanitizar la respuesta en logs
    res.json = function (data) {
        // Log sanitizado solo en desarrollo
        if (process.env.NODE_ENV === 'development') {
            secureLog.debug('Response:', data);
        }
        return originalJson.call(this, data);
    };

    next();
};

export default {
    sanitizeObject,
    sanitizeString,
    secureLog,
    requestLogSanitizer
};
