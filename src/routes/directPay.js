// backend/src/routes/directPay.js
import express from 'express';
import { client } from '../services/vitaClient.js';

const router = express.Router();

/**
 * POST /api/direct-pay/:paymentOrderId
 * 
 * Proxy endpoint for Vita DirectPay
 * Forwards payment_data to Vita's direct_payment endpoint
 * 
 * Based on: BusinessAPI.txt - POST Direct Payment
 */
router.post('/:paymentOrderId', async (req, res) => {
    try {
        const { paymentOrderId } = req.params;
        const { method_id, payment_data } = req.body;

        console.log('[directPay] Processing direct payment for order:', paymentOrderId);
        console.log('[directPay] Method ID:', method_id);
        console.log('[directPay] Payment data:', JSON.stringify(payment_data, null, 2));

        // Validate method_id (required by Vita API)
        if (!method_id) {
            return res.status(400).json({
                ok: false,
                error: 'method_id is required. Must be the ID of the selected payment method.'
            });
        }

        // Validate payment_data
        if (!payment_data || typeof payment_data !== 'object') {
            return res.status(400).json({
                ok: false,
                error: 'payment_data object is required'
            });
        }

        // Forward to Vita API with both method_id and payment_data
        // According to PROMTBusinessAPI.txt (lines 1172-1179), both fields are required
        // vitaClient will handle authentication headers and signature
        const response = await client.post(
            `/payment_orders/${paymentOrderId}/direct_payment`,
            {
                method_id: String(method_id),
                payment_data
            }
        );

        console.log('[directPay] Vita response:', response.status);

        res.json({
            ok: true,
            data: response.data
        });
    } catch (error) {
        console.error('[directPay] Error:', error.response?.data || error.message);

        const status = error?.response?.status || 500;
        const vitaError = error?.response?.data;

        res.status(status).json({
            ok: false,
            error: 'Error processing direct payment',
            details: vitaError || error.message
        });
    }
});

export default router;
