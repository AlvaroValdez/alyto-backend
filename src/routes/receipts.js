// src/routes/receipts.js
import express from 'express';
import receiptService from '../services/receipt/receiptService.js';
import emailService from '../services/receipt/emailService.js';
import Receipt from '../models/Receipt.js';
import { protect, isAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   POST /api/receipts/generate
 * @desc    Generar comprobante oficial para una transacción
 * @access  Protected
 */
router.post('/generate', protect, async (req, res) => {
    try {
        const { transactionId, sendEmail } = req.body;

        if (!transactionId) {
            return res.status(400).json({
                success: false,
                message: 'transactionId es requerido'
            });
        }

        // Generar comprobante
        const receipt = await receiptService.generateReceipt(transactionId, req.user._id);

        // Enviar por email si se solicita
        if (sendEmail !== false) {
            const pdfBuffer = receipt.pdfBuffer;
            const emailResult = await emailService.sendReceipt(receipt, pdfBuffer);

            await receipt.markAsSent(req.user._id, emailResult.success, emailResult.error);
        }

        res.status(201).json({
            success: true,
            message: 'Comprobante generado exitosamente',
            data: {
                receiptNumber: receipt.receiptNumber,
                _id: receipt._id,
                verificationUrl: receipt.verification.url,
                emailSent: receipt.emailDelivery.sent
            }
        });

    } catch (error) {
        console.error('Error generando comprobante:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error al generar comprobante'
        });
    }
});

/**
 * @route   GET /api/receipts/:receiptNumber/view
 * @desc    Ver comprobante como HTML (público — para compartir por WhatsApp/redes)
 * @access  Public
 */
router.get('/:receiptNumber/view', async (req, res) => {
    try {
        const { receiptNumber } = req.params;
        const receipt = await Receipt.findByReceiptNumber(receiptNumber);

        if (!receipt || receipt.isVoided) {
            return res.status(404).send('<html><body><h2>Comprobante no encontrado o anulado.</h2></body></html>');
        }

        const { generateReceiptHTML } = await import('../templates/receiptTemplate.js');
        const html = generateReceiptHTML(receipt.receiptData);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (error) {
        console.error('Error sirviendo comprobante público:', error);
        res.status(500).send('<html><body><h2>Error al cargar el comprobante.</h2></body></html>');
    }
});

/**
 * @route   GET /api/receipts/:receiptNumber
 * @desc    Obtener información del comprobante
 * @access  Protected
 */
router.get('/:receiptNumber', protect, async (req, res) => {
    try {
        const { receiptNumber } = req.params;

        const receipt = await Receipt.findByReceiptNumber(receiptNumber);

        if (!receipt) {
            return res.status(404).json({
                success: false,
                message: 'Comprobante no encontrado'
            });
        }

        // Verificar que el usuario tenga acceso al comprobante
        if (receipt.clientId.toString() !== req.user._id.toString() && !req.user.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'No tienes permiso para ver este comprobante'
            });
        }

        res.json({
            success: true,
            data: receipt
        });

    } catch (error) {
        console.error('Error obteniendo comprobante:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener comprobante'
        });
    }
});

/**
 * @route   GET /api/receipts/:receiptNumber/pdf
 * @desc    Descargar PDF del comprobante
 * @access  Protected
 */
router.get('/:receiptNumber/pdf', protect, async (req, res) => {
    try {
        const { receiptNumber } = req.params;

        const { receipt, pdf } = await receiptService.getReceiptWithPDF(receiptNumber);

        if (!receipt) {
            return res.status(404).json({
                success: false,
                message: 'Comprobante no encontrado'
            });
        }

        // Verificar que el usuario tenga acceso
        if (receipt.clientId.toString() !== req.user._id.toString() && !req.user.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'No tienes permiso para descargar este comprobante'
            });
        }

        // Enviar PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${receiptNumber}.pdf"`);
        res.send(pdf);

    } catch (error) {
        console.error('Error descargando PDF:', error);
        res.status(500).json({
            success: false,
            message: 'Error al descargar PDF'
        });
    }
});

/**
 * @route   GET /api/receipts/client/:clientId
 * @desc    Listar comprobantes de un cliente
 * @access  Protected
 */
router.get('/client/:clientId', protect, async (req, res) => {
    try {
        const { clientId } = req.params;
        const { limit = 50, skip = 0, includeVoided = false } = req.query;

        // Verificar que el usuario tenga acceso
        if (clientId !== req.user._id.toString() && !req.user.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'No tienes permiso para ver estos comprobantes'
            });
        }

        const receipts = await receiptService.listClientReceipts(clientId, {
            limit: parseInt(limit),
            skip: parseInt(skip),
            includeVoided: includeVoided === 'true'
        });

        res.json({
            success: true,
            count: receipts.length,
            data: receipts
        });

    } catch (error) {
        console.error('Error listando comprobantes:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar comprobantes'
        });
    }
});

/**
 * @route   GET /api/receipts/my/list
 * @desc    Listar comprobantes del usuario autenticado
 * @access  Protected
 */
router.get('/my/list', protect, async (req, res) => {
    try {
        const { limit = 50, skip = 0 } = req.query;

        const receipts = await receiptService.listClientReceipts(req.user._id, {
            limit: parseInt(limit),
            skip: parseInt(skip),
            includeVoided: false
        });

        res.json({
            success: true,
            count: receipts.length,
            data: receipts
        });

    } catch (error) {
        console.error('Error listando mis comprobantes:', error);
        res.status(500).json({
            success: false,
            message: 'Error al listar comprobantes'
        });
    }
});

/**
 * @route   POST /api/receipts/:receiptNumber/resend
 * @desc    Reenviar comprobante por email
 * @access  Protected
 */
router.post('/:receiptNumber/resend', protect, async (req, res) => {
    try {
        const { receiptNumber } = req.params;

        const { receipt, pdf } = await receiptService.getReceiptWithPDF(receiptNumber);

        if (!receipt) {
            return res.status(404).json({
                success: false,
                message: 'Comprobante no encontrado'
            });
        }

        // Verificar que el usuario tenga acceso
        if (receipt.clientId.toString() !== req.user._id.toString() && !req.user.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'No tienes permiso para reenviar este comprobante'
            });
        }

        // Reenviar email
        const emailResult = await emailService.sendReceipt(receipt, pdf);

        // Marcar como enviado
        await receipt.markAsSent(req.user._id, emailResult.success, emailResult.error);

        res.json({
            success: true,
            message: emailResult.success
                ? 'Comprobante reenviado exitosamente'
                : 'Error al reenviar comprobante',
            data: {
                emailSent: emailResult.success,
                error: emailResult.error
            }
        });

    } catch (error) {
        console.error('Error reenviando comprobante:', error);
        res.status(500).json({
            success: false,
            message: 'Error al reenviar comprobante'
        });
    }
});

/**
 * @route   POST /api/receipts/:receiptNumber/void
 * @desc    Anular comprobante (solo admin)
 * @access  Admin
 */
router.post('/:receiptNumber/void', protect, isAdmin, async (req, res) => {
    try {
        const { receiptNumber } = req.params;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({
                success: false,
                message: 'La razón de anulación es requerida'
            });
        }

        const receipt = await receiptService.voidReceipt(receiptNumber, req.user._id, reason);

        res.json({
            success: true,
            message: 'Comprobante anulado exitosamente',
            data: {
                receiptNumber: receipt.receiptNumber,
                isVoided: receipt.isVoided,
                voidReason: receipt.voidReason,
                voidedAt: receipt.voidedAt
            }
        });

    } catch (error) {
        console.error('Error anulando comprobante:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error al anular comprobante'
        });
    }
});

/**
 * @route   POST /api/receipts/:receiptNumber/regenerate-pdf
 * @desc    Regenerar PDF del comprobante (solo admin)
 * @access  Admin
 */
router.post('/:receiptNumber/regenerate-pdf', protect, isAdmin, async (req, res) => {
    try {
        const { receiptNumber } = req.params;

        const pdfBuffer = await receiptService.regeneratePDF(receiptNumber);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${receiptNumber}.pdf"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Error regenerando PDF:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Error al regenerar PDF'
        });
    }
});

export default router;
