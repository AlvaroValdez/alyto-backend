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
// Alineado con SUPPORTED_ORIGINS de supportedOrigins.js
const CURRENCY_TO_COUNTRY = {
  COP: 'CO', // Colombia
  ARS: 'AR', // Argentina
  PEN: 'PE', // Perú
  BRL: 'BR', // Brasil
  MXN: 'MX', // México
  CLP: 'CL', // Chile
  BOB: 'BO', // Bolivia (Anchor Manual)
  VES: 'VE', // Venezuela (futuro)
  USD: 'US', // USA
  EUR: 'EU'  // Europa
};

// Tasas de respaldo con códigos de PAÍS (2 letras) para asegurar compatibilidad
// RATES: Costo en CLP de 1 unidad de la moneda destino (aprox)
// Solo se usan en modo desarrollo cuando Vita API no está disponible
const FALLBACK_RATES = [
  { code: 'CO', rate: 0.23 },   // 1 COP = 0.23 CLP
  { code: 'AR', rate: 0.95 },   // 1 ARS = 0.95 CLP
  { code: 'PE', rate: 255.0 },  // 1 PEN = 255 CLP
  { code: 'BR', rate: 190.0 },  // 1 BRL = 190 CLP
  { code: 'MX', rate: 55.0 },   // 1 MXN = 55 CLP
  { code: 'BO', rate: 140.0 },  // 1 BOB = 140 CLP (Anchor Manual)
  { code: 'VE', rate: 0.025 },  // 1 VES = 0.025 CLP
  { code: 'US', rate: 980.0 },  // 1 USD = 980 CLP
  { code: 'EU', rate: 1050.0 }, // 1 EUR = 1050 CLP
  { code: 'CL', rate: 1.0 }     // 1 CLP = 1 CLP
];

// --- HELPER NORMALIZADOR ---
/**
 * Normaliza la respuesta de precios de Vita API
 * 
 * Estructura de Vita (PROMTBusinessAPI.txt líneas 251-323):
 * {
 *   "clp": { "withdrawal": { "prices": { "attributes": { "clp_sell": {...}, "fixed_cost": {...} } } } },
 *   "usd": { "withdrawal": { "prices": { "attributes": { "usd_sell": {...}, "fixed_cost_usd": {...} } } } }
 * }
 * 
 * Extrae precios de TODOS los balances disponibles (no solo CLP)
 * 
 * @param {Object} responseData - Respuesta completa de /prices
 * @returns {Array} Array de objetos { code, rate, fixedCost, sourceCurrency }
 */
const normalizePricesFromVita = (responseData) => {
  const result = [];

  // Iterar sobre todos los balances de moneda disponibles (clp, usd, etc.)
  const availableBalances = Object.keys(responseData || {}).filter(key =>
    key.toLowerCase() === 'clp' || key.toLowerCase() === 'usd' || key.toLowerCase() === 'eur'
  );

  if (availableBalances.length === 0) {
    console.warn('⚠️ [vitaService] No se encontraron balances en la respuesta de Vita');
    return [];
  }

  availableBalances.forEach(balanceKey => {
    const balanceData = responseData[balanceKey];
    const withdrawal = balanceData?.withdrawal;

    if (!withdrawal?.prices?.attributes) {
      console.warn(`⚠️ [vitaService] Balance ${balanceKey} no tiene estructura de precios válida`);
      return;
    }

    const attributes = withdrawal.prices.attributes;
    const sourceCurrency = balanceKey.toUpperCase(); // CLP, USD, EUR

    // Determinar qué campo de tasas usar según la moneda de origen
    // Para CLP: clp_sell, para USD: usd_sell, etc.
    const sellRatesKey = `${balanceKey.toLowerCase()}_sell`;
    const fixedCostKey = sourceCurrency === 'USD' ? 'fixed_cost_usd' : 'fixed_cost';

    const sellRates = attributes[sellRatesKey];
    const fixedCosts = attributes[fixedCostKey] || {};

    if (!sellRates) {
      console.warn(`⚠️ [vitaService] No se encontró ${sellRatesKey} en balance ${balanceKey}`);
      return;
    }

    // Extraer tasas para cada país destino
    Object.entries(sellRates).forEach(([country, rate]) => {
      const countryCode = country.toUpperCase();

      // Evitar duplicados y códigos especiales inválidos
      if (countryCode === 'COCOP' || countryCode.length > 2) return;

      // LOG: Ver valores reales de Vita para debugging
      if (countryCode === 'CO') {
        console.log(`🔍 [Vita] CLP→CO rate from Vita: ${rate} (means 1 CLP = ${rate} COP)`);
      }

      result.push({
        code: countryCode,
        rate: Number(rate),
        fixedCost: Number(fixedCosts[country] || 0),
        sourceCurrency: sourceCurrency // CLP, USD, EUR
      });
    });

    console.log(`✅ [vitaService] Extraídos precios de balance ${sourceCurrency}: ${Object.keys(sellRates).length} países`);
  });

  return result;
};

// Función legacy normalizePrices para compatibilidad con código antiguo
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

  const data = unwrap(res);

  // Normalizar métodos para agregar campo 'code' si no existe
  // Vita devuelve method_id y name, pero DirectPay necesita code
  if (data?.payment_methods) {
    const nameToCode = {
      'Webpay': 'webpay',
      'Fintoc': 'fintoc',
      'PSE': 'pse',
      'Nequi': 'nequi',
      'Daviplata': 'daviplata',
      'Khipu': 'khipu'
    };

    // Campos requeridos para Fintoc (Vita no los devuelve correctamente)
    const fintocRequiredFields = [
      {
        name: 'bank_id',
        type: 'select',
        label: 'Banco',
        required: true,
        options: [
          { value: 'cl_banco_de_chile', label: 'Banco de Chile' },
          { value: 'cl_banco_estado', label: 'Banco Estado' },
          { value: 'cl_banco_santander', label: 'Banco Santander' },
          { value: 'cl_banco_bci', label: 'Banco BCI' },
          { value: 'cl_banco_scotiabank', label: 'Scotiabank' },
          { value: 'cl_banco_itau', label: 'Banco Itaú' }
        ]
      },
      {
        name: 'rut',
        type: 'text',
        label: 'RUT',
        required: true,
        placeholder: '12.345.678-9',
        validation: {
          pattern: '^[0-9]{1,2}\\.[0-9]{3}\\.[0-9]{3}-[0-9Kk]$',
          message: 'Formato: 12.345.678-9'
        }
      },
      {
        name: 'email',
        type: 'email',
        label: 'Email',
        required: true,
        placeholder: 'tu@email.com'
      }
    ];

    data.payment_methods = data.payment_methods.map(method => {
      const code = method.code || nameToCode[method.name] || method.name?.toLowerCase();

      // Si es Fintoc y no tiene required_fields, agregarlos
      const requiredFields = (code === 'fintoc' && (!method.required_fields || method.required_fields.length === 0))
        ? fintocRequiredFields
        : method.required_fields;

      return {
        ...method,
        code,
        payment_method: code,
        required_fields: requiredFields
      };
    });
  }

  return data;
};

// 6. CREAR ORDEN DE PAGO (Payin)
export const createPaymentOrder = async (payload) => {
  const res = await client.post('/payment_orders', payload);
  return unwrap(res);
};

// 7. EJECUTAR PAGO DIRECTO
/**
 * Ejecuta el pago directo para CUALQUIER orden de pago. [cite: 12]
 * @param {string} uid - El ID de la orden (ej: "3622")
 * @param {string|number} method_id - El ID del método (ej: "3")
 * @param {object} payment_data - Datos del pagador
 */
export const executeDirectPayment = async ({ uid, method_id, payment_data }) => {
  const payload = {
    method_id: String(method_id),
    payment_data: payment_data
  };
  // Solo enviamos body limpio. El interceptor leerá el 'uid' de la URL.
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

/**
 * Consulta el estado de un intento de pago específico.
 * Útil para Polling desde el UI o verificación post-pago.
 */
export const getPaymentOrderAttempt = async (paymentOrderId, attemptAltId) => {
  if (!paymentOrderId || !attemptAltId) {
    throw new Error('Missing paymentOrderId or attemptAltId');
  }

  const res = await client.get(
    `/payment_orders/${paymentOrderId}/attempts/${attemptAltId}`
  );

  return unwrap(res);
};