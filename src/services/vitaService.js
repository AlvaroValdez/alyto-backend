// backend/src/services/vitaService.js
import { client } from './vitaClient.js';

// ==========================================
// Helpers
// ==========================================

// Normaliza respuesta Axios vs data directa
const unwrap = (res) => (res && typeof res === 'object' && 'data' in res ? res.data : res);

// --- VARIABLES DE CACHÉ ---
let cachedPrices = null;
let cacheTimestamp = null;
const CACHE_DURATION_MS = 60 * 1000;
let pricesPromise = null;

// --- MAPA DE COMPATIBILIDAD (Moneda -> País) ---
// Vital para que el Frontend muestre las banderas correctamente
const CURRENCY_TO_COUNTRY = {
  COP: 'CO', // Colombia
  ARS: 'AR', // Argentina
  PEN: 'PE', // Perú
  BRL: 'BR', // Brasil
  MXN: 'MX', // México
  CLP: 'CL', // Chile
  VES: 'VE', // Venezuela
  USD: 'US', // USA
  EUR: 'EU', // Europa
  BOL: 'BO', // Bolivia
  BOB: 'BO'  // Bolivia
};

// Tasas de respaldo con códigos de PAÍS (2 letras) para asegurar compatibilidad
// RATES: Costo en CLP de 1 unidad de la moneda destino (aprox)
const FALLBACK_RATES = [
  { code: 'CO', rate: 0.23 },   // 1 COP = 0.23 CLP
  { code: 'AR', rate: 0.95 },   // 1 ARS = 0.95 CLP
  { code: 'PE', rate: 255.0 },  // 1 PEN = 255 CLP
  { code: 'BR', rate: 190.0 },  // 1 BRL = 190 CLP
  { code: 'MX', rate: 55.0 },   // 1 MXN = 55 CLP
  { code: 'VE', rate: 0.025 },  // 1 VES = 0.025 CLP
  { code: 'US', rate: 980.0 },  // 1 USD = 980 CLP
  { code: 'EU', rate: 1050.0 }, // 1 EUR = 1050 CLP
  { code: 'CL', rate: 1.0 },
  { code: 'BO', rate: 140.0 }   // 1 BOB = 140 CLP
];

// --- HELPER NORMALIZADOR ---
const normalizePricesFromVita = (responseData) => {
  const result = [];

  // Extraer sección CLP del response de Vita
  const clp = responseData?.clp?.withdrawal;
  if (!clp?.prices?.attributes?.clp_sell) {
    console.warn('⚠️ [vitaService] No CLP balance found in Vita response');
    return [];
  }

  const sellRates = clp.prices.attributes.clp_sell;
  const fixedCosts = clp.prices.attributes.fixed_cost || {};

  Object.entries(sellRates).forEach(([country, rate]) => {
    // Convertir códigos a mayúsculas: "co" → "CO"
    const countryCode = country.toUpperCase();

    // Evitar duplicados (cocop es lo mismo que co)
    if (countryCode === 'COCOP') return;

    // Normalizar códigos especiales
    if (countryCode.length <= 2 || countryCode === 'GT' || countryCode === 'USRTP') {
      result.push({
        code: countryCode,
        rate: Number(rate),
        fixedCost: Number(fixedCosts[country] || 0)
      });
    }
  });

  return result;
};

// Función legacy normalizePrices para compatibilidad
const normalizePrices = (responseData) => {
  // Si viene estructura antigua (array), mantener compatibilidad
  const raw = responseData?.data ?? responseData;

  if (Array.isArray(raw)) {
    const normalized = [];
    raw.forEach((item) => {
      const rawCode = item.code || item.currency || item.iso_code;
      const rate = item.rate ?? item.price ?? item.value;

      if (rawCode && rate !== undefined && rate !== null) {
        const upperCode = String(rawCode).toUpperCase();
        const finalCode = CURRENCY_TO_COUNTRY[upperCode] || upperCode;

        if (finalCode.length <= 3) {
          normalized.push({ code: finalCode, rate: Number(rate) });
        }
      }
    });
    return normalized;
  }

  // Si tiene estructura Vita, usar normalizador nuevo
  return normalizePricesFromVita(responseData);
};

// ==========================================
// FUNCIONES EXPORTADAS
// ==========================================

// 1. OBTENER PRECIOS (Con Caché)
export const getListPrices = async () => {
  if (cachedPrices && (Date.now() - cacheTimestamp < CACHE_DURATION_MS)) {
    return cachedPrices;
  }
  if (pricesPromise) return pricesPromise;

  pricesPromise = client.get('/prices')
    .then((res) => {
      const data = unwrap(res);

      console.log('[vitaService] 📊 Vita /prices response keys:', Object.keys(data || {}));

      // Usar nuevo normalizador para estructura Vita
      let cleanPrices = normalizePricesFromVita(data);

      // Si no hay precios, intentar fallback solo en desarrollo
      if (cleanPrices.length === 0) {
        console.warn('⚠️ [vitaService] No prices extracted from Vita response');

        if (process.env.NODE_ENV === 'development') {
          console.warn('⚠️ [vitaService] Using FALLBACK_RATES (development only)');
          cleanPrices = FALLBACK_RATES;
        } else {
          throw new Error('No prices available from Vita API');
        }
      }

      console.log(`✅ [vitaService] Loaded ${cleanPrices.length} price rates from Vita`);

      cachedPrices = cleanPrices;
      cacheTimestamp = Date.now();
      pricesPromise = null;
      return cleanPrices;
    })
    .catch((error) => {
      console.error('❌ [vitaService] Error obteniendo precios:', error?.message || error);
      pricesPromise = null;

      // En desarrollo, usar fallback como último recurso
      if (process.env.NODE_ENV === 'development') {
        console.warn('⚠️ [vitaService] API failed, using FALLBACK_RATES (development only)');
        return FALLBACK_RATES;
      }

      throw error;
    });

  return pricesPromise;
};

// 2. FORZAR ACTUALIZACIÓN DE PRECIOS
export const forceRefreshPrices = async () => {
  console.log('🔄 [vitaService] Forzando actualización de precios (Bypass Cache)...');
  try {
    const res = await client.get('/prices');
    const data = unwrap(res);
    const cleanPrices = normalizePrices(data);
    cachedPrices = cleanPrices;
    cacheTimestamp = Date.now();
    console.log('✅ [vitaService] Precios refrescados correctamente.');
    return true;
  } catch (error) {
    console.error('⚠️ [vitaService] Falló el refresco de precios:', error?.message || error);
    return false;
  }
};

// 3. REGLAS DE RETIRO
export const getWithdrawalRules = async () => {
  const res = await client.get('/withdrawal_rules');
  return unwrap(res);
};

// 4. CREAR RETIRO
export const createWithdrawal = async (payload) => {
  const res = await client.post('/transactions', payload);
  // Vita suele responder como { data: {..., checkout_url, ...} }
  return res?.data ?? res;
};


// 5. MÉTODOS DE PAGO
export const getPaymentMethods = async (country) => {
  const cc = String(country).toLowerCase();

  const res = await client.get(`/payment_methods/${cc}`, {
    headers: {
      // DirectPay exige explícitamente x-trans-key en lugar de (o además de) x-api-key
      'x-trans-key': process.env.VITA_TRANS_KEY
    },
    // Bandera personalizada para que el interceptor sepa cómo firmar
    isDirectPayment: true
  });

  return unwrap(res);
};

// 6. CREAR ORDEN DE PAGO (Payin)
export const createPaymentOrder = async (payload) => {
  const res = await client.post('/payment_orders', payload);
  return unwrap(res);
};

// 7. EJECUTAR PAGO DIRECTO
export const executeDirectPayment = async ({ uid, method_id, payment_data }) => {
  if (!uid) throw new Error('Missing uid');
  if (!method_id) throw new Error('Missing method_id');
  if (!payment_data || typeof payment_data !== 'object') throw new Error('Missing payment_data');

  // ⚠️ CRÍTICO: method_id debe ser string para que la firma HMAC coincida
  const payload = {
    method_id: String(method_id),
    payment_data
  };

  console.log('[vitaService] Ejecutando DirectPayment:', payload);

  const res = await client.post(`/payment_orders/${uid}/direct_payment`, payload);
  return unwrap(res);
};

export const createDirectPaymentOrder = executeDirectPayment;

// 8. COTIZACIÓN
// ⚠️ En Vita Business, la cotización/FX normalmente se obtiene vía endpoints de prices/crypto_prices
// y/o cálculo interno. Si tu proyecto usa otro endpoint, colócalo aquí apuntando al ORIGIN correcto.
// Por ahora lo dejamos explícitamente no implementado para evitar 404 silenciosos.
export const getQuote = async () => {
  throw new Error('getQuote no está implementado en vitaService. Usa /prices + lógica interna.');
};
