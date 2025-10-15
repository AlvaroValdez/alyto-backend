// backend/src/utils/normalize.js
// Fuente Vita: GET /api/businesses/prices
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

  const originSection = prices[originKey];
  if (!originSection || !originSection.withdrawal) return null;

  const attrs = originSection.withdrawal.prices?.attributes || {};
  
  // Busca la clave de tasas que termina en "_sell" (ej: "clp_sell")
  const rateKey = Object.keys(attrs).find(k => k.toLowerCase().endsWith('_sell'));
  if (!rateKey) return null;

  const rateMap = attrs[rateKey];
  if (!rateMap || typeof rateMap !== 'object') return null;

  const sellPrice = rateMap[destKey]; // Usa claves en minúsculas
  if (!sellPrice) return null;

  return {
    sell_price: sellPrice,
    min_amount: attrs.min_amount?.[destKey],
    fixed_cost: attrs.fixed_cost?.[destKey],
    dest_currency: attrs.clp_sell?.[destKey] ? destKey.toUpperCase() : 'USD', // Asume moneda local o USD
    payment_methods: originSection.withdrawal.payment_methods || []
  };
};
