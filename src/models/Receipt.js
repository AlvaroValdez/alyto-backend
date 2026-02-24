// src/models/Receipt.js
import mongoose from 'mongoose';

/**
 * MODELO: Receipt (Comprobante Oficial de Transacción)
 * 
 * Documento legal válido para:
 * - Justificación de gastos ante Impuestos Nacionales Bolivia
 * - Deducibilidad del IUE (Impuesto sobre las Utilidades de las Empresas)
 * - Cumplimiento del Anexo de Bancarización (FORM 610)
 * 
 * Conforme a:
 * - Ley N° 1613 (Código Tributario Boliviano)
 * - Decreto Supremo N° 5301, Art. 7
 * - Decreto Supremo N° 5384 (ETF/PSAV)
 * - Circular ASFI 885/2025
 * - RND 10-24-000021
 */
const receiptSchema = new mongoose.Schema({

    // ==========================================
    // IDENTIFICACIÓN DEL COMPROBANTE
    // ==========================================

    /**
     * Número único y correlativo del comprobante
     * Formato: ALY-{YYYY}-{NNNNNN}
     * Ejemplo: ALY-2026-000159
     */
    receiptNumber: {
        type: String,
        unique: true,
        required: true,
        index: true
    },

    // ==========================================
    // RELACIONES
    // ==========================================

    /**
     * Referencia a la transacción que generó este comprobante
     */
    transactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction',
        required: true,
        index: true
    },

    /**
     * Usuario/Cliente que realizó la transacción
     */
    clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // ==========================================
    // DATOS DE LA TRANSACCIÓN
    // ==========================================

    transaction: {
        /**
         * Timestamp de la transacción (ISO 8601 con timezone)
         */
        timestamp: {
            type: Date,
            required: true
        },

        /**
         * Tipo de operación
         * - COMPRA_ACTIVOS: Compra de Activos Virtuales
         * - PAGO_TERCEROS: Pago a Terceros (Transferencia)
         * - REMESA_SALIENTE: Transferencia Internacional Saliente
         * - CONVERSION: Conversión BOB ↔ USD
         */
        type: {
            type: String,
            enum: ['COMPRA_ACTIVOS', 'PAGO_TERCEROS', 'REMESA_SALIENTE', 'CONVERSION'],
            required: true
        },

        /**
         * Hash único de la transacción en Blockchain Stellar (TXID)
         * 64 caracteres hexadecimales
         * Prueba inmutable en red distribuida
         */
        txHash: {
            type: String,
            required: true,
            unique: true,
            match: /^[a-f0-9]{64}$/i
        },

        /**
         * Red blockchain utilizada
         */
        network: {
            type: String,
            default: 'Stellar Network (Mainnet)'
        },

        /**
         * Estado de la transacción
         */
        status: {
            type: String,
            enum: ['CONFIRMADA', 'PENDIENTE', 'FALLIDA'],
            required: true,
            default: 'CONFIRMADA'
        }
    },

    // ==========================================
    // DATOS DEL CLIENTE
    // ==========================================

    client: {
        /**
         * Razón Social o Nombre Completo del cliente
         */
        legalName: {
            type: String,
            required: true
        },

        /**
         * NIT o CI del cliente
         * 7-12 dígitos para NIT boliviano
         */
        nit: {
            type: String,
            required: true,
            match: /^\d{7,12}$/
        },

        /**
         * Código único de KYC
         * Formato: KYC-BOL-{YYYY}-{SEQUENCE}
         */
        kycCode: {
            type: String,
            required: true
        },

        /**
         * Email de contacto del cliente
         */
        email: {
            type: String,
            required: true
        }
    },

    // ==========================================
    // DETALLE ECONÓMICO
    // ==========================================

    amount: {
        /**
         * Moneda de origen (normalmente BOB)
         */
        currency: {
            type: String,
            default: 'BOB',
            required: true
        },

        /**
         * Monto recibido del cliente en bolivianos
         */
        received: {
            type: Number,
            required: true,
            min: 0
        },

        /**
         * Tipo de cambio BOB/USD aplicado
         */
        exchangeRate: {
            type: Number,
            required: true,
            min: 0
        },

        /**
         * Equivalente en USD
         */
        usdEquivalent: {
            type: Number,
            required: true,
            min: 0
        },

        /**
         * Porcentaje de comisión del servicio (Fee)
         */
        feePercentage: {
            type: Number,
            required: true,
            min: 0,
            max: 100
        },

        /**
         * Monto de la comisión en bolivianos
         */
        feeAmount: {
            type: Number,
            required: true,
            min: 0
        },

        /**
         * Monto neto para conversión (received - feeAmount)
         */
        netAmount: {
            type: Number,
            required: true,
            min: 0
        },

        /**
         * Total de la operación (normalmente igual a received)
         */
        total: {
            type: Number,
            required: true,
            min: 0
        }
    },

    // ==========================================
    // ACTIVO VIRTUAL ENTREGADO
    // ==========================================

    crypto: {
        /**
         * Cantidad del activo virtual entregado
         * 8 decimales de precisión
         */
        amount: {
            type: Number,
            required: true,
            min: 0
        },

        /**
         * Símbolo del token (USDC, USDT, XLM, etc.)
         */
        symbol: {
            type: String,
            required: true,
            uppercase: true
        },

        /**
         * Dirección de wallet destino en Stellar
         */
        destinationWallet: {
            type: String,
            required: true
        }
    },

    // ==========================================
    // VERIFICACIÓN Y SEGURIDAD
    // ==========================================

    verification: {
        /**
         * QR Code en formato Base64
         * Contiene URL de verificación pública
         */
        qrCode: {
            type: String
        },

        /**
         * URL pública de verificación
         * Formato: https://alyto.app/verify/{txHash}
         */
        url: {
            type: String
        },

        /**
         * URL al explorador de blockchain Stellar
         */
        stellarExplorerUrl: {
            type: String
        }
    },

    // ==========================================
    // ALMACENAMIENTO DEL PDF
    // ==========================================

    /**
     * URL del PDF generado (puede ser S3, Cloudinary, o path local)
     */
    pdfUrl: {
        type: String
    },

    /**
     * Buffer del PDF (opcional, para almacenamiento directo en MongoDB)
     * Nota: No recomendado para PDFs grandes
     */
    pdfBuffer: {
        type: Buffer
    },

    // ==========================================
    // ENVÍO POR EMAIL
    // ==========================================

    emailDelivery: {
        /**
         * Email fue enviado exitosamente
         */
        sent: {
            type: Boolean,
            default: false
        },

        /**
         * Fecha del primer envío
         */
        sentAt: {
            type: Date
        },

        /**
         * Número de reenvíos
         */
        resendCount: {
            type: Number,
            default: 0
        },

        /**
         * Historial de envíos
         */
        history: [{
            sentAt: Date,
            sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            success: Boolean,
            error: String
        }]
    },

    // ==========================================
    // METADATOS Y AUDITORÍA
    // ==========================================

    /**
     * Usuario que generó el comprobante
     */
    generatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    /**
     * Timestamp de generación del comprobante
     */
    generatedAt: {
        type: Date,
        default: Date.now,
        required: true
    },

    /**
     * Timezone de generación (para Bolivia: GMT-4)
     */
    timezone: {
        type: String,
        default: 'GMT-4'
    },

    /**
     * Firma digital autorizada (opcional)
     */
    authorizedBy: {
        type: String
    },

    /**
     * Indica si el comprobante fue anulado
     */
    isVoided: {
        type: Boolean,
        default: false
    },

    /**
     * Razón de anulación
     */
    voidReason: {
        type: String
    },

    /**
     * Fecha de anulación
     */
    voidedAt: {
        type: Date
    },

    /**
     * Usuario que anuló el comprobante
     */
    voidedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }

}, {
    timestamps: true,
    // Opciones para conservación legal (5 años según Ley N° 1613)
    collection: 'receipts'
});

// ==========================================
// ÍNDICES PARA PERFORMANCE
// ==========================================

receiptSchema.index({ receiptNumber: 1 }, { unique: true });
receiptSchema.index({ 'transaction.txHash': 1 }, { unique: true });
receiptSchema.index({ transactionId: 1 });
receiptSchema.index({ clientId: 1, generatedAt: -1 });
receiptSchema.index({ 'client.nit': 1, generatedAt: -1 });
receiptSchema.index({ generatedAt: -1 });
receiptSchema.index({ isVoided: 1 });

// ==========================================
// MÉTODOS DEL MODELO
// ==========================================

/**
 * Método para formatear monto en bolivianos
 */
receiptSchema.methods.formatBOB = function (amount) {
    return `Bs. ${amount.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;
};

/**
 * Método para formatear monto en USD
 */
receiptSchema.methods.formatUSD = function (amount) {
    return `$${amount.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;
};

/**
 * Método para truncar wallet address
 */
receiptSchema.methods.truncateWallet = function (wallet) {
    if (wallet.length > 20) {
        return `${wallet.slice(0, 8)}...${wallet.slice(-6)}`;
    }
    return wallet;
};

/**
 * Método para marcar como enviado por email
 */
receiptSchema.methods.markAsSent = async function (userId, success = true, error = null) {
    this.emailDelivery.sent = success;
    this.emailDelivery.sentAt = this.emailDelivery.sentAt || new Date();
    this.emailDelivery.resendCount = (this.emailDelivery.resendCount || 0) + 1;
    this.emailDelivery.history.push({
        sentAt: new Date(),
        sentBy: userId,
        success,
        error
    });
    await this.save();
};

/**
 * Método para anular comprobante
 */
receiptSchema.methods.void = async function (userId, reason) {
    this.isVoided = true;
    this.voidReason = reason;
    this.voidedAt = new Date();
    this.voidedBy = userId;
    await this.save();
};

// ==========================================
// STATICS METHODS
// ==========================================

/**
 * Buscar comprobante por número
 */
receiptSchema.statics.findByReceiptNumber = function (receiptNumber) {
    return this.findOne({ receiptNumber, isVoided: false })
        .populate('clientId', 'name email')
        .populate('transactionId');
};

/**
 * Buscar comprobante por hash de transacción
 */
receiptSchema.statics.findByTxHash = function (txHash) {
    return this.findOne({ 'transaction.txHash': txHash, isVoided: false })
        .populate('clientId', 'name email')
        .populate('transactionId');
};

/**
 * Listar comprobantes del cliente
 */
receiptSchema.statics.findByClient = function (clientId, options = {}) {
    const { limit = 50, skip = 0, includeVoided = false } = options;

    const query = { clientId };
    if (!includeVoided) {
        query.isVoided = false;
    }

    return this.find(query)
        .sort({ generatedAt: -1 })
        .limit(limit)
        .skip(skip)
        .populate('transactionId', 'order status');
};

const Receipt = mongoose.model('Receipt', receiptSchema);

export default Receipt;
