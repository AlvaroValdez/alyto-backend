import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// --- CONFIGURACIÓN Y CACHÉ ---
// Mantenemos la lógica de caché del código antiguo para evitar lentitud
let cachedPrices = null;
let cacheTimestamp = null;
const CACHE_DURATION_MS = 60 * 1000; // 60 segundos (según recomendación antigua)
let pricesPromise = null;

// --- 1. NORMALIZACIÓN DE URL ---
const getApiDomain = () => {
  let url = vita.apiUrl;
  if (url.endsWith('/')) url = url.slice(0, -1);
  if (url.endsWith('/api')) url = url.slice(0, -4);
  return url;
};
const API_DOMAIN = getApiDomain();

// --- 2. GESTIÓN DE HEADERS (SOLUCIÓN ERROR 401) ---
const getAuthHeaders = (method, bodyString = '') => {
  const apiKey = vita.apiKey || vita.apiSecret;
  if (!apiKey) throw new Error("CONFIG ERROR: Falta VITA_API_KEY.");

  const date = Math.floor(Date.now() / 1000);

  // LÓGICA HÍBRIDA:
  // GET: Usa la llave plana (Soluciona el 401 en /prices)
  // POST: Usa la llave plana O firma HMAC según requiera el endpoint específico.
  // Por defecto en Business API v2, la mayoría de endpoints aceptan la llave plana.

  const headers = {
    'x-login': vita.apiLogin,
    'x-trans-key': apiKey, // ENVIAMOS LA LLAVE REAL, NO EL HASH
    'x-date': date,
    'Content-Type': 'application/json'
  };

  return headers;
};

// --- 3. NORMALIZADOR INTERNO (ADAPTADO DEL CÓDIGO ANTIGUO) ---
// Transforma la respuesta de Vita (sea cual sea su formato) a { code: 'CO', rate: 123 }
const normalizePrices = (responseData) => {
  const rawData = responseData.data || responseData;
  const normalized = [];

  // CASO A: Respuesta tipo Array (Típica de Business API)
  // Ejemplo: [{ currency: 'cop', price: 3800 }, ...]
  if (Array.isArray(rawData)) {
    rawData.forEach(item => {
      // Intentamos detectar las llaves comunes que usa Vita
      const code = item.code || item.currency || item.iso_code;
      const rate = item.rate || item.price || item.value;

      if (code && rate) {
        normalized.push({
          code: String(code).toUpperCase(), // Forzamos mayúsculas (Lección aprendida)
          rate: Number(rate)
        });
      }
    });
    return normalized;
  }

  // CASO B: Respuesta tipo Objeto/Mapa (Típica de Consumer API antigua)
  // Si por alguna razón tu endpoint devuelve el formato antiguo anidado
  if (typeof rawData === 'object' && rawData !== null) {
    Object.entries(rawData).forEach(([key, value]) => {
      // Lógica simplificada para extraer tasa si es un objeto plano { "COP": 3800 }
      if (typeof value === 'number') {
        normalized.push({ code: key.toUpperCase(), rate: value });
      }
      // Si es el objeto complejo antiguo (withdrawal.prices...), se requeriría el parser antiguo.
      // Asumiremos que Business API devuelve estructura plana o array.
    });
    return normalized;
  }

  return [];
};

// --- 4. CLIENTE HTTP ---
const sendRequest = async (method, endpoint, data = null) => {
  const url = `${API_DOMAIN}${endpoint}`;
  const bodyString = data ? JSON.stringify(data) : '';
  const headers = getAuthHeaders(method, bodyString);

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
    console.error(`❌ [VitaService] Error ${error.response?.status} en ${url}`);
    if (error.response?.status === 401) {
      console.error("⚠️ AUTH ERROR: Verifica x-login y x-trans-key (API Key).");
    }
    throw error;
  }
};

// ==========================================
// ENDPOINTS PÚBLICOS DEL SERVICIO
// ==========================================

// 1. OBTENER LISTA DE PRECIOS (CON CACHÉ Y NORMALIZACIÓN)
// Esta función reemplaza a tu antigua ruta '/meta/countries'
export const getListPrices = async () => {
  // Verificación de caché
  if (cachedPrices && (Date.now() - cacheTimestamp < CACHE_DURATION_MS)) {
    return cachedPrices;
  }
  if (pricesPromise) return pricesPromise;

  // Llamada al endpoint de Negocios
  pricesPromise = sendRequest('GET', '/api/businesses/prices')
    .then((rawResponse) => {

      // Aplicamos normalización inmediata
      const cleanPrices = normalizePrices(rawResponse);

      if (cleanPrices.length > 0) {
        console.log(`✅ [VitaService] Precios actualizados: ${cleanPrices.length} destinos.`);
        cachedPrices = cleanPrices;
        cacheTimestamp = Date.now();
        pricesPromise = null;
        return cleanPrices;
      } else {
        // Fallback: Si el endpoint de negocios devuelve vacío, intentamos loguear para debug
        console.warn("⚠️ [VitaService] Respuesta vacía o formato desconocido:", rawResponse);
        pricesPromise = null;
        return [];
      }
    })
    .catch(error => {
      pricesPromise = null;
      throw error;
    });

  return pricesPromise;
};

// 2. REGLAS DE RETIRO
export const getWithdrawalRules = async () => {
  // Nota: En Business API, esto suele ser una lista general, no por país en la query
  return await sendRequest('GET', '/api/businesses/withdrawal_rules');
};

// 3. MÉTODOS DE PAGO
export const getPaymentMethods = async (country) => {
  return await sendRequest('GET', `/api/businesses/payment_methods/${country}`);
};

// 4. TRANSACCIONES
export const createWithdrawal = async (payload) => {
  return await sendRequest('POST', '/api/businesses/transactions', payload);
};

export const createPaymentOrder = async (payload) => {
  return await sendRequest('POST', '/api/businesses/payment_orders', payload);
};

export const executeDirectPayment = async (data) => {
  const { uid, ...paymentDetails } = data;
  const payload = { payment_data: paymentDetails };
  return await sendRequest('POST', `/api/businesses/payment_orders/${uid}/direct_payment`, payload);
};
export const createDirectPaymentOrder = executeDirectPayment;

// 5. COTIZACIÓN (CALCULADORA)
export const getQuote = async (data) => {
  return await sendRequest('POST', '/api/exchange/calculation', data);
};