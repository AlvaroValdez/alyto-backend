// src/routes/publicVerify.js
import express from 'express';
import Receipt from '../models/Receipt.js';

const router = express.Router();

/**
 * @route   GET /public/verify/:txHash
 * @desc    Verificación pública de comprobante por hash de transacción
 * @access  Public (sin autenticación)
 */
router.get('/verify/:txHash', async (req, res) => {
    try {
        const { txHash } = req.params;

        // Buscar comprobante por hash de transacción
        const receipt = await Receipt.findByTxHash(txHash);

        if (!receipt) {
            return res.status(404).json({
                success: false,
                message: 'Comprobante no encontrado',
                verified: false
            });
        }

        // Si el comprobante está anulado, informarlo
        if (receipt.isVoided) {
            return res.status(200).json({
                success: true,
                verified: false,
                isVoided: true,
                message: 'Este comprobante ha sido anulado',
                data: {
                    receiptNumber: receipt.receiptNumber,
                    voidReason: receipt.voidReason,
                    voidedAt: receipt.voidedAt
                }
            });
        }

        // Devolver información pública del comprobante (sin datos sensibles)
        res.json({
            success: true,
            verified: true,
            message: 'Comprobante válido',
            data: {
                receiptNumber: receipt.receiptNumber,
                generatedAt: receipt.generatedAt,
                transaction: {
                    timestamp: receipt.transaction.timestamp,
                    type: receipt.transaction.type,
                    txHash: receipt.transaction.txHash,
                    network: receipt.transaction.network,
                    status: receipt.transaction.status
                },
                amount: {
                    currency: receipt.amount.currency,
                    total: receipt.amount.total
                },
                verification: {
                    stellarExplorerUrl: receipt.verification.stellarExplorerUrl
                }
            }
        });

    } catch (error) {
        console.error('Error verificando comprobante:', error);
        res.status(500).json({
            success: false,
            message: 'Error al verificar comprobante',
            verified: false
        });
    }
});

/**
 * @route   GET /public/verify/:txHash/details
 * @desc    Obtener detalles completos (para embed en página de verificación)
 * @access  Public
 */
router.get('/verify/:txHash/details', async (req, res) => {
    try {
        const { txHash } = req.params;

        const receipt = await Receipt.findByTxHash(txHash);

        if (!receipt || receipt.isVoided) {
            return res.status(404).json({
                success: false,
                message: 'Comprobante no encontrado o anulado'
            });
        }

        // Devolver detalles más completos (pero sin datos sensibles del cliente)
        res.json({
            success: true,
            data: {
                receiptNumber: receipt.receiptNumber,
                generatedAt: receipt.generatedAt,
                transaction: receipt.transaction,
                amount: receipt.amount,
                crypto: {
                    amount: receipt.crypto.amount,
                    symbol: receipt.crypto.symbol
                    // No enviar destinationWallet por privacidad
                },
                verification: receipt.verification,
                // Datos ofuscados del cliente (solo para mostrar en UI)
                client: {
                    legalName: receipt.client.legalName.replace(/(?<=.{3}).(?=.{3})/g, '*'),
                    nit: receipt.client.nit.replace(/(?<=.{2}).(?=.{2})/g, '*')
                }
            }
        });

    } catch (error) {
        console.error('Error obteniendo detalles:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener detalles'
        });
    }
});

export default router;
