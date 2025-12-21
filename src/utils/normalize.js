// backend/src/utils/normalize.js
// Fuente Vita: GET /prices
// Justificación: Vita entrega precios anidados por moneda → withdrawal → attributes.

/**
 * Busca y normaliza la información de precios para un par de divisas específico
 * dentro de la compleja estructura de datos devuelta por la API de Vita Wallet.
 * @param {object} prices - El objeto de precios completo de la API.
 * @param {object} options - Contiene la moneda de origen y el país de destino.
 * @param {string} options.originCurrency - ej: 'CLP'
 * @param {string} options.destCountry - ej: 'CO'
 * @returns {object|null} Un objeto normalizado con la tasa y costos, o null si no se encuentra.
 */
export const findPrice = (prices, { originCurrency, destCountry }) => {
  if (!prices) return null;

  const originKey = originCurrency.toLowerCase();
  const destKey = destCountry.toLowerCase();

  // 1. Busqueda Estructura Anidada (Legacy / Consumer)
  if (prices[originKey] && prices[originKey].withdrawal) {
    const attrs = prices[originKey].withdrawal.prices?.attributes || {};
    const rateKey = Object.keys(attrs).find(k => k.toLowerCase().endsWith('_sell'));
    if (rateKey && attrs[rateKey] && attrs[rateKey][destKey]) {
      return {
        sell_price: attrs[rateKey][destKey],
        min_amount: attrs.min_amount?.[destKey],
        fixed_cost: attrs.fixed_cost?.[destKey],
        dest_currency: attrs.clp_sell?.[destKey] ? destKey.toUpperCase() : 'USD',
        payment_methods: prices[originKey].withdrawal.payment_methods || []
      };
    }
  }

  // 2. Busqueda Estructura Plana (Business API / Stage)
  const flatKey = `${originKey}_sell`;
  if (prices[flatKey] && prices[flatKey][destKey]) {
    return {
      sell_price: prices[flatKey][destKey],
      // En estructura plana a veces no vienen min_amount/fixed_cost por país, usaremos defaults
      min_amount: 5000,
      fixed_cost: 0,
      dest_currency: 'USD', // Default seguro
      payment_methods: []
    };
  }

  return null;
};
