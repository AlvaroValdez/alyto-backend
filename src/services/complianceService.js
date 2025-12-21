// backend/src/services/complianceService.js
import ComplianceLimits from '../models/ComplianceLimits.js';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';

/**
 * Servicio de validación de cumplimiento regulatorio
 */

/**
 * Valida si una transacción cumple con los límites regulatorios
 * @param {string} userId - ID del usuario
 * @param {number} amount - Monto de la transacción
 * @param {string} currency - Moneda (BOB, CLP, etc.)
 * @param {string} country - País de origen (BO, CL, etc.)
 * @returns {Promise<{valid: boolean, reason?: string, requiresApproval?: boolean}>}
 */
export async function validateComplianceLimits(userId, amount, currency, country) {
    try {
        // 1. Obtener límites del país
        const limits = await ComplianceLimits.findOne({ country: country.toUpperCase(), isActive: true });

        if (!limits) {
            console.warn(`[Compliance] No se encontraron límites para ${country}. Transacción permitida por defecto.`);
            return { valid: true };
        }

        // 2. Obtener usuario y nivel KYC
        const user = await User.findById(userId);
        if (!user) {
            return { valid: false, reason: 'Usuario no encontrado' };
        }

        const kycLevel = user.kyc?.level || 1;
        const levelLimits = limits.kycLevels[`level${kycLevel}`];

        if (!levelLimits) {
            return { valid: false, reason: `Nivel KYC ${kycLevel} no configurado para ${country}` };
        }

        // 3. Validar límites mínimos/máximos
        if (limits.restrictions.minTransactionAmount > 0 && amount < limits.restrictions.minTransactionAmount) {
            return {
                valid: false,
                reason: `Monto mínimo: ${limits.restrictions.minTransactionAmount} ${currency}`
            };
        }

        if (limits.restrictions.maxTransactionAmount > 0 && amount > limits.restrictions.maxTransactionAmount) {
            return {
                valid: false,
                reason: `Monto máximo: ${limits.restrictions.maxTransactionAmount} ${currency}`
            };
        }

        // 4. Calcular totales del período
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfYear = new Date(now.getFullYear(), 0, 1);

        const [dailyTotal, monthlyTotal, annualTotal] = await Promise.all([
            getTransactionTotal(userId, currency, startOfDay),
            getTransactionTotal(userId, currency, startOfMonth),
            getTransactionTotal(userId, currency, startOfYear)
        ]);

        // 5. Validar límites diarios
        if (levelLimits.daily > 0 && (dailyTotal + amount) > levelLimits.daily) {
            return {
                valid: false,
                reason: `Límite diario excedido. Límite: ${levelLimits.daily} ${currency}, Ya usado: ${dailyTotal} ${currency}`
            };
        }

        // 6. Validar límites mensuales
        if (levelLimits.monthly > 0 && (monthlyTotal + amount) > levelLimits.monthly) {
            return {
                valid: false,
                reason: `Límite mensual excedido. Límite: ${levelLimits.monthly} ${currency}, Ya usado: ${monthlyTotal} ${currency}`
            };
        }

        // 7. Validar límites anuales
        if (levelLimits.annual > 0 && (annualTotal + amount) > levelLimits.annual) {
            return {
                valid: false,
                reason: `Límite anual excedido. Límite: ${levelLimits.annual} ${currency}, Ya usado: ${annualTotal} ${currency}`
            };
        }

        // 8. Verificar umbrales AML
        let requiresApproval = limits.restrictions.requiresManualApproval;

        if (amount >= limits.amlThresholds.highRiskThreshold) {
            requiresApproval = true;
            console.warn(`[Compliance] ⚠️  Transacción de alto riesgo: ${amount} ${currency} >= ${limits.amlThresholds.highRiskThreshold}`);
        }

        if (amount >= limits.amlThresholds.reportingThreshold) {
            console.warn(`[Compliance] 📋 Transacción requiere reporte AML: ${amount} ${currency}`);
            // Aquí se podría crear automáticamente un reporte AML
            await logAMLReport(userId, amount, currency, 'threshold_exceeded');
        }

        // 9. Verificar países prohibidos (OFAC, listas negras)
        if (user.nationality && limits.restrictions.blacklistedCountries.includes(user.nationality)) {
            return {
                valid: false,
                reason: `Transacciones desde ${user.nationality} están restringidas para ${country}`
            };
        }

        return { valid: true, requiresApproval };

    } catch (error) {
        console.error('[Compliance] Error validando límites:', error);
        // En caso de error, denegar por seguridad
        return { valid: false, reason: 'Error al validar límites de cumplimiento' };
    }
}

/**
 * Calcula el total de transacciones de un usuario desde una fecha
 */
async function getTransactionTotal(userId, currency, since) {
    const result = await Transaction.aggregate([
        {
            $match: {
                createdBy: userId,
                currency: currency.toUpperCase(),
                status: { $in: ['pending', 'pending_verification', 'processing', 'succeeded'] },
                createdAt: { $gte: since }
            }
        },
        {
            $group: {
                _id: null,
                total: { $sum: '$amount' }
            }
        }
    ]);

    return result.length > 0 ? result[0].total : 0;
}

/**
 * Registra un reporte AML para auditoría
 */
async function logAMLReport(userId, amount, currency, reason) {
    // TODO: Implementar modelo AMLReport para guardar estos reportes
    console.log(`[AML Report] Usuario: ${userId}, Monto: ${amount} ${currency}, Razón: ${reason}`);

    // Aquí podrías:
    // 1. Guardar en BD
    // 2. Enviar a sistema externo de compliance
    // 3. Notificar al oficial de cumplimiento
}

/**
 * Inicializa límites para Bolivia (ASFI)
 * Llamar desde un script de seed o admin panel
 */
export async function seedBoliviaLimits() {
    const boliviaLimits = {
        country: 'BO',
        currency: 'BOB',
        kycLevels: {
            level1: {
                daily: 3500,     // ~$us 500 @ 7 Bs/USD
                monthly: 35000,  // ~$us 5,000
                annual: 350000   // ~$us 50,000
            },
            level2: {
                daily: 70000,    // ~$us 10,000
                monthly: 350000, // ~$us 50,000
                annual: 3500000  // ~$us 500,000
            },
            level3: {
                daily: 350000,   // ~$us 50,000
                monthly: 3500000, // ~$us 500,000
                annual: 35000000  // ~$us 5,000,000
            }
        },
        amlThresholds: {
            reportingThreshold: 70000,          // Bs 70,000 (~$us 10,000) - reporte automático
            suspiciousActivityThreshold: 35000, // Bs 35,000 (~$us 5,000) - revisión manual
            highRiskThreshold: 350000           // Bs 350,000 (~$us 50,000) - aprobación especial
        },
        restrictions: {
            blacklistedCountries: ['IR', 'KP', 'SY', 'CU'], // OFAC sanctions
            requiresManualApproval: true, // Bolivia requiere aprobación manual por regulación
            minTransactionAmount: 10,
            maxTransactionAmount: 0 // Sin límite superior (validado por KYC)
        },
        regulatory: {
            authority: 'ASFI',
            licenseRequired: true,
            notes: 'Cumplimiento según normativa ASFI Bolivia para remesas transfronterizas'
        },
        isActive: true
    };

    await ComplianceLimits.findOneAndUpdate(
        { country: 'BO' },
        boliviaLimits,
        { upsert: true, new: true }
    );

    console.log('✅ Límites de Bolivia (ASFI) inicializados correctamente');
}
