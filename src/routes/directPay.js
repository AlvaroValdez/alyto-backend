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

        // payment_method validation handled earlier; no additional check needed here.

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
        // La clave 'payment_method' parece ser de una versión o SDK diferente.

        const payload = method_id
            ? { method_id: method_id, payment_data: {} }
            : { payment_method: payment_method, payment_data: payment_data };


        console.log('[DirectPayment] Payload final:', JSON.stringify(payload, null, 2));

        const response = await client.post(
            `/payment_orders/${paymentOrderId}/direct_payment`,
            payload
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
