// Utility function for calculating Fintoc fees based on TransactionConfig
// Follows Opción B (Estimación Conservadora) from implementation plan

/**
 * Fintoc Tier Rates (in UF per transaction)
 * Based on monthly transaction volume
 */
const FINTOC_TIER_RATES = {
    1: 0.0135, // 0-5,000 txns/month
    2: 0.0115, // 5,000-25,000 txns/month
    3: 0.0105, // 25,000-50,000 txns/month
    4: 0.0097, // 50,000-100,000 txns/month
    5: 0.0090  // 100,000+ txns/month
};

/**
 * Calculate Fintoc fee based on config
 * @param {number} transactionAmount - Transaction amount in CLP
 * @param {object} fintocConfig - Config from TransactionConfig.fintocConfig
 * @param {number} fintocConfig.ufValue - Current UF value in CLP
 * @param {number} fintocConfig.tier - Volume tier (1-5)
 * @returns {object} - { fixedFee, percentage, tierRate, ufValue }
 */
export function calculateFintocFee(transactionAmount, fintocConfig = {}) {
    // Defaults if config not provided
    const ufValue = fintocConfig?.ufValue || 37500;
    const tier = fintocConfig?.tier || 1;

    // Get tier rate
    const tierRate = FINTOC_TIER_RATES[tier] || FINTOC_TIER_RATES[1];

    // Calculate fixed fee in CLP
    const fixedFee = Math.round(tierRate * ufValue);

    // Calculate effective percentage for this transaction
    const percentage = transactionAmount > 0
        ? (fixedFee / transactionAmount) * 100
        : 0;

    return {
        fixedFee,       // Fee in CLP (e.g., 431)
        percentage,     // Effective % (e.g., 4.31 for 10K txn)
        tierRate,       // Rate in UF (e.g., 0.0115)
        ufValue,        // UF value used (e.g., 37500)
        tier            // Tier used (e.g., 2)
    };
}

/**
 * Get Fintoc fee percentage for quote/marquee calculations
 * Uses average transaction amount for conservative estimate
 * @param {object} fintocConfig - Config from TransactionConfig
 * @param {number} avgAmount - Average transaction amount (default 10000 CLP)
 * @returns {number} - Effective fee percentage
 */
export function getFintocFeePercent(fintocConfig, avgAmount = 10000) {
    const { percentage } = calculateFintocFee(avgAmount, fintocConfig);
    return percentage;
}

export default {
    calculateFintocFee,
    getFintocFeePercent,
    FINTOC_TIER_RATES
};
