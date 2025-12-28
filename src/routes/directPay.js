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
        const { payment_method, payment_data } = req.body;

        console.log('[DirectPayment] Processing for order:', paymentOrderId);
        console.log('[DirectPayment] Payment method:', payment_method);
        console.log('[DirectPayment] Payment data:', JSON.stringify(payment_data, null, 2));

        // Validar payment_method (requerido por Vita API)
        if (!payment_method) {
            return res.status(400).json({
                ok: false,
                error: 'payment_method es requerido. Debe ser el código del método (ej: "pse", "nequi", "fintoc")'
            });
        }

        // Validar payment_data
        if (!payment_data || typeof payment_data !== 'object') {
            return res.status(400).json({
                ok: false,
                error: 'payment_data es requerido y debe ser un objeto con los campos del método'
            });
        }

        // Llamar a Vita API
        // El vitaClient manejará automáticamente:
        // - Headers de autenticación (x-date, x-login, x-trans-key)
        // - Generación de firma HMAC-SHA256
        // - Serialización correcta del payload

        // CORRECCIÓN SEGÚN IMAGEN USUARIO: Fintoc requiere payment_data VACÍO
        // Si enviamos datos extra, el servidor los filtra y la firma no coincide (Error 303)
        let finalPaymentData = payment_data;
        if (payment_method === 'fintoc' || payment_method === 'Fintoc') {
            console.log('[DirectPay] Fintoc detectado: Forzando payment_data vacío según documentación.');
            finalPaymentData = {};
        }

        const payload = {
            // ESTRATEGIA FINAL: Soportada por DirectPaymentFintoc.txt y fix de firma vacía
            payment_method: payment_method, // 'fintoc'
            payment_data: finalPaymentData  // {}
        };

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
