/**
 * src/utils/normalize.js
 * Mapea Monedas (Business API) a Países (Frontend Legacy)
 */

// Mapa manual para convertir lo que da Vita (Moneda) a lo que quiere el Front (País)
const CURRENCY_TO_COUNTRY = {
  'COP': 'CO', // Colombia
  'ARS': 'AR', // Argentina
  'PEN': 'PE', // Perú
  'BRL': 'BR', // Brasil
  'MXN': 'MX', // México
  'CLP': 'CL', // Chile
  'VES': 'VE', // Venezuela
  'USD': 'US', // USA
  'EUR': 'EU', // Europa
  'BOL': 'BO', // Bolivia
  'BOB': 'BO'  // Bolivia
};

export function getSellMapFor(vitaPrices, originCurrency) {
  if (!vitaPrices) return {};

  // CASO A: Array (API Business / Mock)
  if (Array.isArray(vitaPrices)) {
    const map = {};
    vitaPrices.forEach(p => {
      // Normalizamos el código a mayúsculas
      const rawCode = (p.code || '').toUpperCase();
      // Traducimos 3 letras (COP) a 2 letras (CO)
      const countryCode = CURRENCY_TO_COUNTRY[rawCode] || rawCode;

      if (countryCode && p.rate) {
        map[countryCode.toLowerCase()] = p.rate;
      }
    });
    return map;
  }

  // CASO B: Objeto Legacy (Consumer API)
  if (typeof vitaPrices === 'object') {
    const originKey = String(originCurrency || '').toUpperCase();
    const originNode = vitaPrices[originKey];

    const sellMap =
      originNode?.withdrawal?.prices?.attributes?.sell ||
      originNode?.withdrawal?.prices?.sell ||
      originNode?.withdrawal?.sell ||
      null;

    if (sellMap && typeof sellMap === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(sellMap)) {
        if (v !== null && v !== undefined) {
          // Aquí asumimos que el Legacy ya traía claves de país (co, ar...)
          out[String(k).toLowerCase()] = Number(v);
        }
      }
      return out;
    }
  }

  return {};
}

export function extractCountries(vitaPrices, originCurrency) {
  const sellMap = getSellMapFor(vitaPrices, originCurrency);

  const entries = Object.entries(sellMap)
    .filter(([, rate]) => Number.isFinite(rate))
    .map(([code, rate]) => ({
      code: code.toUpperCase(), // Devolvemos siempre mayúsculas (CO, AR)
      rate
    }));

  // Ordenar alfabéticamente
  entries.sort((a, b) => a.code.localeCompare(b.code));

  return entries;
}