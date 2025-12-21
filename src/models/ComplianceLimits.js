// backend/src/models/ComplianceLimits.js
import mongoose from 'mongoose';

/**
 * Modelo de límites de cumplimiento por país
 * Define límites KYC, umbrales de reporte AML, y restricciones regulatorias
 */
const complianceLimitsSchema = new mongoose.Schema({
    country: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true,
        match: /^[A-Z]{2}$/ // Código ISO 3166-1 alpha-2
    },

    currency: {
        type: String,
        required: true,
        uppercase: true,
        trim: true,
        match: /^[A-Z]{3}$/ // Código ISO 4217
    },

    // Límites por nivel KYC (en moneda local)
    kycLevels: {
        level1: {
            daily: { type: Number, default: 0 },
            monthly: { type: Number, default: 0 },
            annual: { type: Number, default: 0 }
        },
        level2: {
            daily: { type: Number, default: 0 },
            monthly: { type: Number, default: 0 },
            annual: { type: Number, default: 0 }
        },
        level3: {
            daily: { type: Number, default: 0 },
            monthly: { type: Number, default: 0 },
            annual: { type: Number, default: 0 }
        }
    },

    // Umbrales de reporte AML/PLD (en moneda local)
    amlThresholds: {
        reportingThreshold: { type: Number, default: 0 }, // Monto que requiere reporte automático
        suspiciousActivityThreshold: { type: Number, default: 0 }, // Monto que requiere revisión manual
        highRiskThreshold: { type: Number, default: 0 } // Monto que requiere aprobación especial
    },

    // Restricciones adicionales
    restrictions: {
        blacklistedCountries: [String], // Países de origen prohibidos (OFAC, etc.)
        requiresManualApproval: { type: Boolean, default: false }, // Si todas las transacciones requieren aprobación
        minTransactionAmount: { type: Number, default: 0 },
        maxTransactionAmount: { type: Number, default: 0 }
    },

    // Metadata regulatoria
    regulatory: {
        authority: String, // Ej: "ASFI" (Bolivia), "CMF" (Chile)
        licenseRequired: { type: Boolean, default: false },
        licenseNumber: String,
        notes: String
    },

    isActive: { type: Boolean, default: true }

}, { timestamps: true });

// Índices
complianceLimitsSchema.index({ country: 1 });
complianceLimitsSchema.index({ isActive: 1 });

const ComplianceLimits = mongoose.model('ComplianceLimits', complianceLimitsSchema);

export default ComplianceLimits;
