// backend/src/routes/directPayment.js
import express from 'express';
import { client } from '../services/vitaClient.js';

const router = express.Router();

/**
 * POST /api/direct-payment/:paymentOrderId
 * 
 * Ejecuta un pago directo según especificación de Vita Wallet Business API
 * 
 * Basado en:
 * - PROMTBusinessAPI.txt líneas 1154-1356
 * - DirectPayment-dos.txt líneas 838-877
 * 
 * Request Body (CORRECTO):
 * {
 *   "payment_method": "pse" | "nequi" | "daviplata" | "tdc" | "fintoc",
 *   "payment_data": {
 *     // Campos específicos del método seleccionado
 *   }
 * }
 * 
 * ⚠️ IMPORTANTE: El campo es "payment_method" (NO "method_id")
 */
router.post('/:paymentOrderId', async (req, res) => {
    try {
        const { paymentOrderId } = req.params;
        const { payment_method, payment_data, method_id } = req.body;

        console.log('[DirectPayment] Request body recibido:', JSON.stringify(req.body, null, 2));

        // Validar que se envíe al menos payment_method o method_id
        if (!payment_method && !method_id) {
            return res.status(400).json({
                ok: false,
                error: 'payment_method o method_id es requerido (ej: "pse", "nequi", "fintoc")'
            });
        }


        console.log('[DirectPayment] Processing for order:', paymentOrderId);
        console.log('[DirectPayment] Payment method:', payment_method || method_id);
        console.log('[DirectPayment] Payment data:', JSON.stringify(payment_data, null, 2));

        // No validar payment_method aquí; la validación se hace arriba aceptando method_id o payment_method.

        // Validar payment_data (puede estar vacío para algunos métodos)
        if (payment_data && typeof payment_data !== 'object') {
            return res.status(400).json({
                ok: false,
                error: 'payment_data debe ser un objeto cuando se envía'
            });
        }

        // Llamar a Vita API
        // El vitaClient manejará automáticamente:
        // - Headers de autenticación (x-date, x-login, x-trans-key)
        // - Generación de firma HMAC-SHA256
        // - Serialización correcta del payload

        // CORRECCIÓN ROBUSTA: Resolver ID dinámicamente si es necesario

        let finalPayload;

        // 1. Si ya tenemos un ID numérico claro, lo usamos
        if (method_id && !isNaN(method_id)) {
            finalPayload = { method_id: String(method_id), payment_data: {} };
        }
        else {
            // 2. Si vino "fintoc" (texto) ya sea en payment_method o method_id
            const isFintocStart = (payment_method === 'fintoc') || (method_id === 'fintoc');

            if (isFintocStart) {
                console.log('[DirectPayment] Detectado intento Fintoc sin ID numérico. Buscando ID en API...');
                try {
                    // Obtenemos métodos de Chile (CL) para buscar el ID de Fintoc
                    // Nota: Asumimos CL para este fix específico
                    const methodsResponse = await client.get('/payment_methods/CL');
                    const methods = methodsResponse.data?.payment_methods || methodsResponse.data || [];

                    const fintocMethod = methods.find(m => m.code === 'fintoc');

                    if (fintocMethod && fintocMethod.id) {
                        console.log(`[DirectPayment] ID de Fintoc encontrado: ${fintocMethod.id}`);
                        finalPayload = {
                            method_id: String(fintocMethod.id),
                            payment_data: {}
                        };
                    } else {
                        throw new Error('No se pudo encontrar el ID de Fintoc en la API de Vita');
                    }
                } catch (err) {
                    console.error('[DirectPayment] Error buscando ID de Fintoc:', err.message);
                    // Fallback desesperado: mandamos string "fintoc"
                    finalPayload = { method_id: 'fintoc', payment_data: {} };
                }
            }
            // 3. Otros métodos con payment_method (PSE, etc)
            else if (payment_method) {
                finalPayload = {
                    payment_method: payment_method,
                    payment_data: payment_data
                };
            }
        }

        console.log('[DirectPayment] Payload final:', JSON.stringify(finalPayload, null, 2));

        const response = await client.post(
            `/payment_orders/${paymentOrderId}/direct_payment`,
            finalPayload
        );

        console.log('[DirectPayment] Vita response status:', response.status);

        // Retornar respuesta de Vita
        res.json({
            ok: true,
            data: response.data
        });

    } catch (error) {
        console.error('[DirectPayment] Error:', error.response?.data || error.message);

        const status = error?.response?.status || 500;
        const vitaError = error?.response?.data;

        res.status(status).json({
            ok: false,
            error: 'Error procesando pago directo',
            details: vitaError || error.message
        });
    }
});

export default router;
