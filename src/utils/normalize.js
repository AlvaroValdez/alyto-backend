// src/utils/normalize.js

/**
 * Normaliza la respuesta para obtener un mapa de tasas de venta.
 * Soporta tanto la respuesta cruda de Vita como el Array ya procesado por el servicio.
 */
export function getSellMapFor(vitaPrices, originCurrency) {
  if (!vitaPrices) return {};

  // CASO A: vitaPrices ya es un Array (viene del vitaService nuevo/mock)
  if (Array.isArray(vitaPrices)) {
    const map = {};
    vitaPrices.forEach(p => {
      if (p.code && p.rate) {
        map[p.code.toLowerCase()] = p.rate;
      }
    });
    return map;
  }

  // CASO B: vitaPrices es Objeto Complejo (Legacy / Estructura antigua)
  if (typeof vitaPrices === 'object') {
    const originKey = String(originCurrency || '').toUpperCase();
    const originNode = vitaPrices[originKey];

    // Intenta navegar la estructura profunda
    const sellMap =
      originNode?.withdrawal?.prices?.attributes?.sell ||
      originNode?.withdrawal?.prices?.sell ||
      originNode?.withdrawal?.sell ||
      null;

    if (sellMap && typeof sellMap === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(sellMap)) {
        if (v !== null && v !== undefined) {
          out[String(k).toLowerCase()] = Number(v);
        }
      }
      return out;
    }
  }

  return {};
}

/**
 * Genera la lista limpia { code: "CO", rate: 123 } para el Frontend
 */
export function extractCountries(vitaPrices, originCurrency) {
  const sellMap = getSellMapFor(vitaPrices, originCurrency);

  const entries = Object.entries(sellMap)
    .filter(([, rate]) => Number.isFinite(rate))
    .map(([code, rate]) => ({ code: code.toUpperCase(), rate }));

  // Ordenar alfabéticamente
  entries.sort((a, b) => a.code.localeCompare(b.code));

  return entries;
}