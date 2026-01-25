// src/models/Counter.js
import mongoose from 'mongoose';

/**
 * MODELO: Counter
 * 
 * Sistema de numeración correlativa para comprobantes.
 * Garantiza que los números de comprobante sean únicos y secuenciales.
 * 
 * CRÍTICO para cumplimiento legal:
 * - La numeración NO puede tener saltos
 * - Debe ser única y correlativa según Ley N° 1613
 */
const counterSchema = new mongoose.Schema({
    /**
     * Tipo de documento
     * - receipt: Comprobantes de pago
     */
    _id: {
        type: String,
        required: true
    },

    /**
     * Secuencia actual
     */
    seq: {
        type: Number,
        default: 0
    },

    /**
     * Año actual (para reseteo anual opcional)
     */
    year: {
        type: Number
    },

    /**
     * Última actualización
     */
    lastUpdated: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// ==========================================
// STATIC METHODS
// ==========================================

/**
 * Obtener el siguiente número de secuencia
 * @param {String} counterName - Nombre del contador (ej: 'receipt')
 * @param {Number} currentYear - Año actual (opcional, para reseteo anual)
 * @returns {Promise<Number>} - Número de secuencia
 */
counterSchema.statics.getNextSequence = async function (counterName, currentYear = null) {
    const year = currentYear || new Date().getFullYear();

    // Buscar o crear el contador
    const counter = await this.findByIdAndUpdate(
        counterName,
        {
            $inc: { seq: 1 },
            $set: {
                lastUpdated: new Date(),
                year
            }
        },
        {
            new: true,
            upsert: true,
            // Usar sesión para transaccionalidad si es necesario
            session: null
        }
    );

    return counter.seq;
};

/**
 * Obtener la secuencia actual sin incrementar
 * @param {String} counterName - Nombre del contador
 * @returns {Promise<Number>} - Número de secuencia actual
 */
counterSchema.statics.getCurrentSequence = async function (counterName) {
    const counter = await this.findById(counterName);
    return counter ? counter.seq : 0;
};

/**
 * Resetear contador (solo para admin, con extremo cuidado)
 * @param {String} counterName - Nombre del contador
 * @param {Number} newSeq - Nueva secuencia (default: 0)
 */
counterSchema.statics.resetCounter = async function (counterName, newSeq = 0) {
    return await this.findByIdAndUpdate(
        counterName,
        {
            seq: newSeq,
            lastUpdated: new Date()
        },
        { new: true, upsert: true }
    );
};

const Counter = mongoose.model('Counter', counterSchema);

export default Counter;
