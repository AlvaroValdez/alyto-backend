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
     * Formato: AVF-{YYYY}-{NNNNNN}
     */
    async generateReceiptNumber() {
        const year = new Date().getFullYear();
        const sequence = await Counter.getNextSequence('receipt', year);

        // Formatear con 6 dígitos (ej: 000159)
        const paddedSeq = String(sequence).padStart(6, '0');

        return `AVF-${year}-${paddedSeq}`;
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
            legalName: process.env.COMPANY_LEGAL_NAME || 'AV Finance S.R.L.',
            nit: process.env.COMPANY_NIT || '123456789',
            address: process.env.COMPANY_ADDRESS || 'Av. Arce #2081, Edificio Multicentro, Piso 8, La Paz - Bolivia',
            phone: process.env.COMPANY_PHONE || '+591 2 211-8765',
            email: process.env.COMPANY_EMAIL || 'soporte@avfinance.bo',
            website: process.env.COMPANY_WEBSITE || 'www.avfinance.bo',
            logoPrefix: 'AV',
            logoSuffix: 'Finance',
            tagline: 'powered by Alyto'
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

        // Calcular montos usando Decimal.js para precisión
        const received = new Decimal(transaction.amount || 0);
        const feePercentage = new Decimal(transaction.feePercent || 0);
        const feeAmount = received.times(feePercentage).div(100);
        const netAmount = received.minus(feeAmount);

        // Obtener tipo de cambio
        const exchangeRate = new Decimal(
            transaction.rateTracking?.alytoRate ||
            transaction.manualRate ||
            6.91
        );

        const usdEquivalent = received.div(exchangeRate);

        // Monto de cripto (puede venir de vitaResponse o calcularse)
        const cryptoAmount = transaction.rateTracking?.profitDestCurrency ||
            transaction.amountsTracking?.destReceiveAmount ||
            netAmount.div(exchangeRate).toNumber();

        // Símbolo del cripto (puede ser dinámico)
        const cryptoSymbol = transaction.currency === 'CLP' ? 'USDT' : 'USDC';

        // Hash de blockchain (puede venir de Vita o generarse mock para testing)
        const txHash = transaction.vitaWithdrawalId ||
            this.generateMockTxHash();

        return {
            transactionType,
            amount: {
                currency: transaction.currency || 'BOB',
                received: received.toNumber(),
                exchangeRate: exchangeRate.toNumber(),
                usdEquivalent: usdEquivalent.toNumber(),
                feePercentage: feePercentage.toNumber(),
                feeAmount: feeAmount.toNumber(),
                netAmount: netAmount.toNumber(),
                total: received.toNumber()
            },
            crypto: {
                amount: cryptoAmount,
                symbol: cryptoSymbol,
                destinationWallet: this.extractWalletFromResponse(transaction.vitaResponse)
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
                crypto: receiptData.crypto,
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
