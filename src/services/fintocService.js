// src/services/fintocService.js
import axios from 'axios';
import crypto from 'crypto';

const FINTOC_API_URL = process.env.FINTOC_API_URL || 'https://api.fintoc.com/v1';
const FINTOC_SECRET_KEY = process.env.FINTOC_SECRET_KEY;
const FINTOC_WEBHOOK_SECRET = process.env.FINTOC_WEBHOOK_SECRET;

if (!FINTOC_SECRET_KEY) {
    console.warn('⚠️ [fintocService] FINTOC_SECRET_KEY no configurado en .env');
}

// Cliente HTTP para Fintoc API
const fintocClient = axios.create({
    baseURL: FINTOC_API_URL,
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json'
    }
});

// Agregar el Authorization header a cada request
fintocClient.interceptors.request.use((config) => {
    if (FINTOC_SECRET_KEY) {
        config.headers['Authorization'] = FINTOC_SECRET_KEY;
    }
    return config;
});

/**
 * Crea un Widget Link (Checkout Session) en Fintoc
 * Esto genera una URL donde el usuario puede pagar
 * 
 * @param {Object} params - Parámetros del widget
 * @param {number} params.amount - Monto en CLP
 * @param {string} params.currency - Código de moneda (default: 'CLP')
 * @param {Object} params.metadata - Metadata personalizada (orderId, userId, etc.)
 * @param {string} params.success_url - URL de redirección después de pago exitoso
 * @returns {Promise<Object>} Respuesta de Fintoc con widget_url e id
 */
export async function createWidgetLink(params) {
    try {
        const {
            amount,
            currency = 'CLP',
            metadata = {},
            success_url
        } = params;

        if (!amount || amount <= 0) {
            throw new Error('Amount must be greater than 0');
        }

        const payload = {
            amount: Math.round(amount), // Fintoc requiere enteros
            currency: currency.toUpperCase(),
            metadata
        };

        // Solo agregar recipient_account si se quiere Direct Payment
        // (requiere credenciales de cuenta bancaria específicas)
        if (process.env.FINTOC_RECIPIENT_HOLDER_ID &&
            process.env.FINTOC_RECIPIENT_ACCOUNT_NUMBER) {
            console.log('[fintocService] Usando Direct Payment con cuenta bancaria');
            payload.recipient_account = {
                holder_id: process.env.FINTOC_RECIPIENT_HOLDER_ID,
                number: process.env.FINTOC_RECIPIENT_ACCOUNT_NUMBER,
                type: process.env.FINTOC_RECIPIENT_ACCOUNT_TYPE || 'checking_account'
            };
        }

        console.log('[fintocService] Creando Payment Link:', {
            amount: payload.amount,
            currency: payload.currency,
            metadata: payload.metadata
        });

        const response = await fintocClient.post('/payment_links', payload);
        const data = response.data;

        console.log('✅ [fintocService] Payment Link creado:', data.id);

        return {
            id: data.id,
            url: data.url,  // Fintoc devuelve 'url' no 'widget_url'
            status: data.status,
            amount: data.amount,
            currency: data.currency,
            metadata: data.metadata,
            created_at: data.created_at
        };

    } catch (error) {
        console.error('❌ [fintocService] Error creando Widget Link:', error.message);
        if (error.response) {
            console.error('[fintocService] Fintoc Error Response:', error.response.data);
            throw new Error(`Fintoc API Error: ${JSON.stringify(error.response.data)}`);
        }
        throw error;
    }
}

/**
 * Verifica la firma de un webhook de Fintoc
 * Esto asegura que el webhook realmente viene de Fintoc
 * 
 * @param {Object} payload - Body del webhook
 * @param {string} signature - Header 'fintoc-signature' del request
 * @returns {boolean} true si la firma es válida
 */
export function verifyFintocWebhook(payload, signature) {
    try {
        if (!FINTOC_WEBHOOK_SECRET) {
            console.warn('⚠️ [fintocService] FINTOC_WEBHOOK_SECRET no configurado. Saltando verificación.');
            return true; // En desarrollo, permitir sin verificación
        }

        if (!signature) {
            console.error('❌ [fintocService] No se recibió signature header');
            return false;
        }

        // Fintoc usa HMAC SHA256 para firmar webhooks
        const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const expectedSignature = crypto
            .createHmac('sha256', FINTOC_WEBHOOK_SECRET)
            .update(payloadString)
            .digest('hex');

        // Comparación segura para prevenir timing attacks
        const isValid = crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );

        if (isValid) {
            console.log('✅ [fintocService] Webhook signature válida');
        } else {
            console.error('❌ [fintocService] Webhook signature inválida');
            console.error('[fintocService] Expected:', expectedSignature);
            console.error('[fintocService] Received:', signature);
        }

        return isValid;

    } catch (error) {
        console.error('❌ [fintocService] Error verificando webhook:', error.message);
        return false;
    }
}

/**
 * Obtiene el estado de un pago/widget link
 * 
 * @param {string} widgetLinkId - ID del widget link
 * @returns {Promise<Object>} Estado del pago
 */
export async function getWidgetLinkStatus(widgetLinkId) {
    try {
        const response = await fintocClient.get(`/payment_links/${widgetLinkId}`);
        const data = response.data;

        return {
            id: data.id,
            status: data.status, // pending, succeeded, failed
            amount: data.amount,
            currency: data.currency,
            metadata: data.metadata,
            payment: data.payment, // Información del pago si está completado
            created_at: data.created_at,
            updated_at: data.updated_at
        };

    } catch (error) {
        console.error(`❌ [fintocService] Error obteniendo estado de ${widgetLinkId}:`, error.message);
        if (error.response) {
            console.error('[fintocService] Fintoc Error Response:', error.response.data);
        }
        throw error;
    }
}

/**
 * Obtiene la estructura de fees de Fintoc
 * Esto se usa en el pricing engine para calcular cotizaciones
 * 
 * @returns {Object} Estructura de fees
 */
export function getFintocFees() {
    // Fees de Fintoc Chile (verificar con tu contrato)
    // Estos valores pueden venir de configuración o de la API de Fintoc
    return {
        percent: Number(process.env.FINTOC_FEE_PERCENT || 1.49), // 1.49% (ejemplo)
        fixed: Number(process.env.FINTOC_FEE_FIXED || 150),       // $150 CLP (ejemplo)
        currency: 'CLP',
        provider: 'fintoc_direct'
    };
}

/**
 * Verifica que el servicio de Fintoc esté configurado correctamente
 * @returns {Object} Estado de configuración
 */
export function checkFintocConfig() {
    return {
        configured: !!FINTOC_SECRET_KEY,
        hasWebhookSecret: !!FINTOC_WEBHOOK_SECRET,
        apiUrl: FINTOC_API_URL
    };
}

export default {
    createWidgetLink,
    verifyFintocWebhook,
    getWidgetLinkStatus,
    getFintocFees,
    checkFintocConfig
};
