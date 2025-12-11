// src/utils/normalize.js

// ... (Mantenemos el objeto CURRENCY_TO_COUNTRY igual) ...
const CURRENCY_TO_COUNTRY = {
  'COP': 'CO', 'ARS': 'AR', 'PEN': 'PE', 'BRL': 'BR',
  'MXN': 'MX', 'CLP': 'CL', 'VES': 'VE', 'USD': 'US',
  'EUR': 'EU', 'BOL': 'BO', 'BOB': 'BO',
  // Agregamos mapeos para los casos de Stage si son necesarios
  'USD_BUY': 'US',
  'USD_SELL': 'US'
};

export function getSellMapFor(vitaPrices, originCurrency) {
  if (!vitaPrices) return {};

  const processItem = (code, rate, map) => {
    if (!code || !rate) return;

    const rawCode = String(code).toUpperCase();
    // Intentamos traducir (ej: COP -> CO, USD_BUY -> US)
    // Si no está en el mapa, usamos el código original recortado a 2 letras si parece un ISO válido
    let finalCode = CURRENCY_TO_COUNTRY[rawCode];

    // Si no tiene traducción directa, y el código es de 2 letras, lo dejamos pasar.
    if (!finalCode && rawCode.length === 2) {
      finalCode = rawCode;
    }

    // FILTRO DE SEGURIDAD: Solo guardamos si el resultado final son EXACTAMENTE 2 letras
    if (finalCode && finalCode.length === 2) {
      map[finalCode.toLowerCase()] = Number(rate);
    }
  };

  // CASO A: Array (API Business / Mock)
  if (Array.isArray(vitaPrices)) {
    const map = {};
    vitaPrices.forEach(p => {
      processItem(p.code, p.rate, map);
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
        processItem(k, v, out);
      }
      return out;
    }
  }

  return {};
}

// ... extractCountries queda IGUAL ...
export function extractCountries(vitaPrices, originCurrency) {
  const sellMap = getSellMapFor(vitaPrices, originCurrency);

  const entries = Object.entries(sellMap)
    .filter(([, rate]) => Number.isFinite(rate))
    .map(([code, rate]) => ({
      code: code.toUpperCase(),
      rate
    }));

  entries.sort((a, b) => a.code.localeCompare(b.code));
  return entries;
}