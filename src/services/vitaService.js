import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// --- 1. DICCIONARIO MAESTRO (METADATA) ---
// Sirve para reconstruir la lista de países si la API de Negocios falla y tenemos que usar la Pública.
const CURRENCY_METADATA = {
  'clp': { code: 'CL', name: 'Chile', flag: '🇨🇱' },
  'cop': { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
  'pen': { code: 'PE', name: 'Perú', flag: '🇵🇪' },
  'ars': { code: 'AR', name: 'Argentina', flag: '🇦🇷' },
  'brl': { code: 'BR', name: 'Brasil', flag: '🇧🇷' },
  'mxn': { code: 'MX', name: 'México', flag: '🇲🇽' },
  'usd': { code: 'US', name: 'Estados Unidos', flag: '🇺🇸' },
  'ves': { code: 'VE', name: 'Venezuela', flag: '🇻🇪' },
  'bob': { code: 'BO', name: 'Bolivia', flag: '🇧🇴' },
  'uyu': { code: 'UY', name: 'Uruguay', flag: '🇺🇾' },
  'pyg': { code: 'PY', name: 'Paraguay', flag: '🇵🇾' },
  'eur': { code: 'EU', name: 'Unión Europea', flag: '🇪🇺' }
};

// --- VARIABLES DE CACHÉ ---
let cachedPrices = null;
let cacheTimestamp = null;
const CACHE_DURATION_MS = 15 * 1000;
let pricesPromise = null;

// --- 2. CONFIGURACIÓN DE URL ---
// Normalizamos la URL base para evitar dobles slashes (//)
const getBaseUrl = () => {
  // Quitamos slash final si existe
  let base = vita.apiUrl.endsWith('/') ? vita.apiUrl.slice(0, -1) : vita.apiUrl;
  // Si la variable de entorno ya incluye /api, la usamos tal cual, 
  // pero nos aseguramos de no duplicar al concatenar.
  return base;
};

// --- 3. CORE DE SEGURIDAD (BLINDADO) ---
const getAuthHeaders = (method, urlPath, bodyString = '') => {
  if (!vita.apiSecret) throw new Error("CONFIG ERROR: Falta VITA_SECRET_KEY.");

  const date = Math.floor(Date.now() / 1000);
  // Firma HMAC-SHA256 usando el bodyString exacto (vacío para GET)
  const signature = crypto.createHmac('sha256', vita.apiSecret).update(bodyString).digest('hex');

  return {
    'Content-Type': 'application/json',
    'x-login': vita.apiLogin,
    'x-trans-key': signature,
    'x-date': date,
  };
};

// --- 4. CLIENTE HTTP ---
const sendRequest = async (method, endpoint, data = null) => {
  // Lógica para evitar /api/api
  let baseUrl = getBaseUrl(); // ej: https://api.vitawallet.io/api

  // Si el endpoint empieza con /api y la base termina en /api, ajustamos
  let finalEndpoint = endpoint;
  if (baseUrl.endsWith('/api') && endpoint.startsWith('/api/')) {
    finalEndpoint = endpoint.replace('/api/', '/');
  }

  const url = `${baseUrl}${finalEndpoint}`;
  const bodyString = data ? JSON.stringify(data) : '';
  const headers = getAuthHeaders(method, finalEndpoint, bodyString);

  try {
    const config = { headers };
    let response;

    if (method === 'GET') {
      response = await axios.get(url, config);
    } else if (method === 'POST') {
      response = await axios.post(url, bodyString, config);
    }

    return response.data;

  } catch (error) {
    // Solo logueamos error si NO es un intento de precios (para no ensuciar el log del fallback)
    if (!endpoint.includes('prices')) {
      console.error(`❌ [VitaService] Error en ${endpoint}:`, error.response?.status || error.message);
    }
    throw error;
  }
};

// ==========================================
// ENDPOINTS
// ==========================================

// 1. OBTENER LISTA DE PRECIOS (CON FALLBACK AUTOMÁTICO)
export const getListPrices = async () => {
  if (cachedPrices && (Date.now() - cacheTimestamp < CACHE_DURATION_MS)) {
    return cachedPrices;
  }
  if (pricesPromise) return pricesPromise;

  pricesPromise = (async () => {
    try {
      // INTENTO A: API de Negocios (La más completa)
      // Usamos la ruta completa /api/...
      const response = await sendRequest('GET', '/api/businesses/prices');
      // Si tiene éxito, usamos la data
      return response.data || response;

    } catch (error) {
      console.warn(`⚠️ [VitaService] Falló API Negocios (${error.response?.status}). Usando API Pública de respaldo.`);

      // INTENTO B: API Pública (Respaldo robusto)
      // Esta devuelve tasas { usd: ..., clp: ... }, así que las transformamos a Países manualmente.
      const publicRates = await sendRequest('GET', '/api/prices');

      // Transformación: Tasas -> Lista de Países
      const countriesList = Object.keys(publicRates)
        .filter(key => CURRENCY_METADATA[key.toLowerCase()]) // Solo monedas conocidas
        .map(key => {
          const meta = CURRENCY_METADATA[key.toLowerCase()];
          return {
            code: meta.code,
            name: meta.name,
            currency: key.toUpperCase(),
            flag: meta.flag,
            rate: publicRates[key]
          };
        });

      // INYECCIÓN MANUAL: Bolivia (BO)
      // Como Bolivia es tu canal manual, lo agregamos siempre si no vino.
      if (!countriesList.find(c => c.code === 'BO')) {
        countriesList.unshift({
          code: 'BO', name: 'Bolivia', currency: 'BOB', flag: '🇧🇴', manual: true, rate: 1
        });
      }

      return countriesList;
    }
  })()
    .then(data => {
      cachedPrices = data;
      cacheTimestamp = Date.now();
      pricesPromise = null;
      return cachedPrices;
    })
    .catch(err => {
      pricesPromise = null;
      // Fallback final: Si todo falla, devolvemos la lista estática básica
      return Object.values(CURRENCY_METADATA).map(m => ({ ...m, currency: Object.keys(CURRENCY_METADATA).find(k => CURRENCY_METADATA[k] === m).toUpperCase(), rate: 1 }));
    });

  return pricesPromise;
};

// 2. REGLAS DE RETIRO
export const getWithdrawalRules = async () => {
  const res = await sendRequest('GET', '/api/businesses/withdrawal_rules');
  return res.data || res;
};

// 3. MÉTODOS DE PAGO (Pay-ins)
export const getPaymentMethods = async (country) => {
  const res = await sendRequest('GET', `/api/businesses/payment_methods/${country}`);
  return res.data || res;
};

// 4. CREAR RETIRO (Payouts)
export const createWithdrawal = async (payload) => {
  return await sendRequest('POST', '/api/businesses/transactions', payload);
};

// 5. CREAR ORDEN DE PAGO (Redirect)
export const createPaymentOrder = async (payload) => {
  return await sendRequest('POST', '/api/businesses/payment_orders', payload);
};

// 6. EJECUTAR PAGO DIRECTO
export const executeDirectPayment = async (data) => {
  const { uid, ...paymentDetails } = data;
  const payload = { payment_data: paymentDetails };
  return await sendRequest('POST', `/api/businesses/payment_orders/${uid}/direct_payment`, payload);
};
export const createDirectPaymentOrder = executeDirectPayment;

// 7. COTIZACIÓN
export const getQuote = async (data) => {
  return await sendRequest('POST', '/api/exchange/calculation', data);
};