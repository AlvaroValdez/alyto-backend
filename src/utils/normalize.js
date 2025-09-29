// backend/src/utils/normalize.js
// Fuente Vita: GET /api/businesses/prices
// Justificación: Vita entrega precios anidados por moneda → withdrawal → attributes.

function findPrice(prices, { originCurrency, destCountry }) {
  if (!prices) return null;

  const originKey = originCurrency.toLowerCase();
  const destKey = destCountry.toLowerCase();

  const originSection = prices[originKey];
  if (!originSection || !originSection.withdrawal) return null;

  const attrs = originSection.withdrawal.prices?.attributes || {};
  // Buscar clave con "_sell" (ej: "clp_sell")
  const rateKey = Object.keys(attrs).find(k => k.toLowerCase().includes('_sell'));
  if (!rateKey) return null;

  const rateMap = attrs[rateKey];
  if (!rateMap || typeof rateMap !== 'object') return null;

  const sellPrice = rateMap[destKey]; // ⚡ aquí usamos minúsculas
  if (!sellPrice) return null;

  return {
    origin_currency: originCurrency,
    destination_country: destCountry,
    sell_price: sellPrice,
    min_amount: originSection.withdrawal.min_amount,
    fixed_cost: originSection.withdrawal.fixed_cost,
    payment_methods: originSection.withdrawal.payment_methods || []
  };
}

module.exports = { findPrice };
