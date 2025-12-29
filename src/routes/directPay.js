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

        // CORRECCIÓN: Usar 'method_id' según ejemplo JSON de documentación (DirectPaymentFintoc.txt line 441)

        let finalPayload;

        // Si method_id viene explícito, usarlo tal cual
        if (method_id) {
            finalPayload = { method_id: method_id, payment_data: {} };
        }
        // Si viene payment_method, verificar si es "fintoc" o un ID numérico (Fintoc usa IDs como "1", "2")
        // O si el frontend mandó "fintoc" en payment_method pero debería ser method_id
        else if (payment_method) {
            // Caso especial: si el frontend envía "fintoc" como payment_method, asumimos que es method_id
            // (esto es un parche de seguridad por si el frontend falla en enviar method_id)
            if (payment_method === 'fintoc' || !isNaN(payment_method)) {
                // Si es Fintoc, Vita requiere payment_data vacío y method_id
                finalPayload = {
                    method_id: payment_method,
                    payment_data: {}
                };
            } else {
                // Otros métodos (PSE, Nequi, etc)
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
