// src/services/receipt/receiptService.js
import Receipt from '../../models/Receipt.js';
import Counter from '../../models/Counter.js';
import Transaction from '../../models/Transaction.js';
import User from '../../models/User.js';
import pdfGenerator from './pdfGenerator.js';
import qrGenerator from './qrGenerator.js';
import Decimal from 'decimal.js';

/**
 * Servicio principal de generación y gestión de comprobantes oficiales
 */
class ReceiptService {

    /**
     * Generar número de comprobante único y correlativo
     * Formato: ALY-{YYYY}-{NNNNNN}
     */
    async generateReceiptNumber() {
        const year = new Date().getFullYear();
        const sequence = await Counter.getNextSequence('receipt', year);

        // Formatear con 6 dígitos (ej: 000159)
        const paddedSeq = String(sequence).padStart(6, '0');

        return `ALY-${year}-${paddedSeq}`;
    }

    /**
     * Generar código KYC del cliente
     * Formato: KYC-BOL-{YYYY}-{SEQUENCE}
     */
    generateKYCCode(userId, year = null) {
        const currentYear = year || new Date().getFullYear();
        // Usar los últimos 4 dígitos del userId como secuencia
        const sequence = userId.toString().slice(-4);
        return `KYC-BOL-${currentYear}-${sequence}`;
    }

    /**
     * Obtener datos de la empresa (configurables vía ENV)
     */
    getCompanyData() {
        return {
            legalName: process.env.COMPANY_LEGAL_NAME || 'Alyto S.R.L.',
            nit: process.env.COMPANY_NIT || '123456789',
            address: process.env.COMPANY_ADDRESS || 'Av. Arce #2081, Edificio Multicentro, Piso 8, La Paz - Bolivia',
            phone: process.env.COMPANY_PHONE || '+591 2 211-8765',
            email: process.env.COMPANY_EMAIL || 'soporte@alyto.app',
            website: process.env.COMPANY_WEBSITE || 'www.alyto.app',
            logoPrefix: 'Aly',
            logoSuffix: 'to',
            tagline: 'Transferencias Internacionales'
        };
    }

    /**
     * Mapear Transaction a formato Receipt
     */
    async mapTransactionToReceipt(transaction, user) {
        // Determinar tipo de operación
        let transactionType = 'COMPRA_ACTIVOS'; // default
        if (transaction.country) {
            transactionType = 'REMESA_SALIENTE';
        }

        const at = transaction.amountsTracking || {};
        const rt = transaction.rateTracking || {};

        // --- Origen ---
        const originCurrency = at.originCurrency || transaction.currency || 'CLP';
        const originTotal    = new Decimal(at.originTotal    ?? transaction.amount ?? 0);
        const originFee      = new Decimal(at.originFee      ?? transaction.fee    ?? 0);
        const originPrincipal = new Decimal(at.originPrincipal ?? originTotal.minus(originFee).toNumber());

        // --- Destino (lo que REALMENTE recibe el beneficiario) ---
        const destCurrency      = at.destCurrency || transaction.country || '';
        const destReceiveAmount = new Decimal(at.destReceiveAmount ?? 0);   // ✅ monto real al beneficiario
        const destGrossAmount   = new Decimal(at.destGrossAmount   ?? destReceiveAmount.toNumber());
        const destVitaCost      = new Decimal(at.destVitaFixedCost ?? 0);

        // --- Tasa efectiva que ve el cliente (lo que paga / lo que recibe) ---
        const alytoRate = new Decimal(
            rt.alytoRate ||
            transaction.manualRate ||
            (destReceiveAmount.gt(0) ? originTotal.div(destReceiveAmount).toNumber() : 1)
        );

        // Hash de la transacción
        const txHash = transaction.vitaWithdrawalId || this.generateMockTxHash();

        return {
            transactionType,
            amount: {
                // Origen
                originCurrency,
                originTotal:     originTotal.toNumber(),       // Total que pagó el usuario
                originFee:       originFee.toNumber(),         // Comisión pasarela (Fintoc)
                originPrincipal: originPrincipal.toNumber(),   // Neto enviado al tipo de cambio

                // Tasa
                exchangeRate: alytoRate.toNumber(),            // Tasa efectiva cliente

                // Destino
                destCurrency,
                destGrossAmount:   destGrossAmount.toNumber(),  // Bruto antes de costo fijo
                destVitaFixedCost: destVitaCost.toNumber(),     // Costo fijo del payout
                destReceiveAmount: destReceiveAmount.toNumber(), // ✅ Lo que recibe el beneficiario

                // Legacy (compatibilidad PDF template)
                currency:    originCurrency,
                received:    originTotal.toNumber(),
                feePercentage: new Decimal(transaction.feePercent ?? 0).toNumber(),
                feeAmount:   originFee.toNumber(),
                netAmount:   originPrincipal.toNumber(),
                total:       originTotal.toNumber()
            },
            destination: {
                currency:       destCurrency,
                receiveAmount:  destReceiveAmount.toNumber(),
                grossAmount:    destGrossAmount.toNumber(),
                fixedCost:      destVitaCost.toNumber(),
                country:        transaction.country || ''
            },
            transaction: {
                timestamp: transaction.createdAt,
                txHash
            },
            client: {
                legalName: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                nit: user.nit || user.ci || 'N/A',
                email: user.email,
                kycCode: this.generateKYCCode(user._id)
            }
        };
    }

    /**
     * Extraer wallet address de la respuesta de Vita (si existe)
     */
    extractWalletFromResponse(vitaResponse) {
        if (!vitaResponse) return null;

        // Intenta extraer del withdrawal payload
        return vitaResponse.wallet_address ||
            vitaResponse.destination_wallet ||
            null;
    }

    /**
     * Generar hash mock de blockchain para testing
     * En producción, esto debe venir de Stellar
     */
    generateMockTxHash() {
        const chars = 'abcdef0123456789';
        let hash = '';
        for (let i = 0; i < 64; i++) {
            hash += chars[Math.floor(Math.random() * chars.length)];
        }
        return hash;
    }

    /**
     * Generar comprobante completo
     * @param {String} transactionId - ID de la transacción
     * @param {String} userId - ID del usuario (opcional, si no se pasa se obtiene de la transacción)
     * @returns {Promise<Object>} - Receipt creado
     */
    async generateReceipt(transactionId, userId = null) {
        try {
            // 1. Obtener transacción
            const transaction = await Transaction.findById(transactionId)
                .populate('createdBy');

            if (!transaction) {
                throw new Error('Transacción no encontrada');
            }

            // 2. Obtener usuario
            const user = userId
                ? await User.findById(userId)
                : transaction.createdBy;

            if (!user) {
                throw new Error('Usuario no encontrado');
            }

            // 3. Verificar si ya existe un comprobante para esta transacción
            const existingReceipt = await Receipt.findOne({
                transactionId,
                isVoided: false
            });

            if (existingReceipt) {
                console.log('Comprobante ya existe para esta transacción');
                return existingReceipt;
            }

            // 4. Generar número de comprobante
            const receiptNumber = await this.generateReceiptNumber();

            // 5. Mapear datos de transacción a formato de comprobante
            const receiptData = await this.mapTransactionToReceipt(transaction, user);

            // 6. Generar QR Code de verificación
            const verification = await qrGenerator.generateVerificationQR(
                receiptData.transaction.txHash
            );

            // 7. Preparar datos completos del comprobante
            const completeReceiptData = {
                receiptNumber,
                company: this.getCompanyData(),
                transaction: {
                    ...receiptData.transaction,
                    type: receiptData.transactionType,
                    network: 'Stellar Network (Mainnet)',
                    status: 'CONFIRMADA'
                },
                client: receiptData.client,
                amount: receiptData.amount,
                destination: receiptData.destination,
                verification,
                generatedAt: new Date(),
                timezone: 'GMT-4'
            };

            // 8. Generar PDF
            const pdfBuffer = await pdfGenerator.generatePDF(completeReceiptData);

            // 9. Crear documento de Receipt en la base de datos
            const receipt = new Receipt({
                receiptNumber,
                transactionId: transaction._id,
                clientId: user._id,

                transaction: {
                    timestamp: receiptData.transaction.timestamp,
                    type: receiptData.transactionType,
                    txHash: receiptData.transaction.txHash,
                    network: 'Stellar Network (Mainnet)',
                    status: 'CONFIRMADA'
                },

                client: receiptData.client,
                amount: receiptData.amount,
                crypto: receiptData.crypto,
                verification,

                receiptData: completeReceiptData, // Para re-renderizar HTML en /view (WhatsApp share)

                pdfBuffer, // Guardar PDF en MongoDB (opcional)

                generatedBy: user._id,
                generatedAt: new Date(),
                timezone: 'GMT-4'
            });

            await receipt.save();

            console.log(`✅ Comprobante ${receiptNumber} generado exitosamente`);

            return receipt;

        } catch (error) {
            console.error('Error generando comprobante:', error);
            throw error;
        }
    }

    /**
     * Obtener comprobante con PDF
     * @param {String} receiptNumber - Número del comprobante
     * @returns {Promise<Object>} - Receipt con PDF
     */
    async getReceiptWithPDF(receiptNumber) {
        const receipt = await Receipt.findByReceiptNumber(receiptNumber);

        if (!receipt) {
            throw new Error('Comprobante no encontrado');
        }

        return {
            receipt,
            pdf: receipt.pdfBuffer
        };
    }

    /**
     * Regenerar PDF de un comprobante existente
     * @param {String} receiptNumber - Número del comprobante
     * @returns {Promise<Buffer>} - Buffer del PDF regenerado
     */
    async regeneratePDF(receiptNumber) {
        const receipt = await Receipt.findByReceiptNumber(receiptNumber);

        if (!receipt) {
            throw new Error('Comprobante no encontrado');
        }

        // Preparar datos para el template
        const receiptData = {
            receiptNumber: receipt.receiptNumber,
            company: this.getCompanyData(),
            transaction: receipt.transaction,
            client: receipt.client,
            amount: receipt.amount,
            crypto: receipt.crypto,
            verification: receipt.verification,
            generatedAt: receipt.generatedAt,
            timezone: receipt.timezone
        };

        const pdfBuffer = await pdfGenerator.generatePDF(receiptData);

        // Actualizar PDF en la base de datos
        receipt.pdfBuffer = pdfBuffer;
        await receipt.save();

        return pdfBuffer;
    }

    /**
     * Listar comprobantes de un cliente
     * @param {String} clientId - ID del cliente
     * @param {Object} options - Opciones de paginación
     * @returns {Promise<Array>} - Lista de comprobantes
     */
    async listClientReceipts(clientId, options = {}) {
        return await Receipt.findByClient(clientId, options);
    }

    /**
     * Anular comprobante
     * @param {String} receiptNumber - Número del comprobante
     * @param {String} userId - ID del usuario que anula
     * @param {String} reason - Razón de anulación
     * @returns {Promise<Object>} - Receipt anulado
     */
    async voidReceipt(receiptNumber, userId, reason) {
        const receipt = await Receipt.findByReceiptNumber(receiptNumber);

        if (!receipt) {
            throw new Error('Comprobante no encontrado');
        }

        if (receipt.isVoided) {
            throw new Error('El comprobante ya está anulado');
        }

        await receipt.void(userId, reason);

        console.log(`❌ Comprobante ${receiptNumber} anulado: ${reason}`);

        return receipt;
    }
}

// Exportar instancia singleton
const receiptService = new ReceiptService();

export default receiptService;
