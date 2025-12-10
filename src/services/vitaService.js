import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// --- VARIABLES DE CACHÉ ---
let cachedPrices = null;
let cacheTimestamp = null;
const CACHE_DURATION_MS = 15 * 1000;
let pricesPromise = null;

// --- 1. CORE DE SEGURIDAD ---
const getAuthHeaders = (method, urlPath, bodyString = '') => {
  if (!vita.apiSecret) throw new Error("CONFIG ERROR: Falta VITA_SECRET_KEY.");

  const date = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', vita.apiSecret).update(bodyString).digest('hex');

  const headers = {
    'x-login': vita.apiLogin,
    'x-trans-key': signature,
    'x-date': date,
  };

  // CORRECCIÓN 401: Solo enviamos Content-Type si hay cuerpo (POST/PUT)
  // Enviar este header en GET a veces causa rechazo en APIs estrictas.
  if (method === 'POST' || bodyString) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
};

// --- 2. CLIENTE HTTP ---
const sendRequest = async (method, endpoint, data = null) => {
  // Aseguramos que no haya duplicidad de /api
  // Si vita.apiUrl termina en /api y endpoint empieza con /api, quitamos uno.
  let baseUrl = vita.apiUrl;
  let finalEndpoint = endpoint;

  if (baseUrl.endsWith('/api') && finalEndpoint.startsWith('/api')) {
    finalEndpoint = finalEndpoint.substring(4); // quitamos '/api' del endpoint
  }

  const url = `${baseUrl}${finalEndpoint}`;

  // Para GET, bodyString debe ser VACÍO EXACTO '' para que la firma coincida
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
    console.error(`[VitaService] Error en ${finalEndpoint}:`, error.response?.data || error.message);
    throw error;
  }
};

// ==========================================
// ENDPOINTS DE NEGOCIO (ORIGINALES)
// ==========================================

// 1. OBTENER LISTA DE PRECIOS (Business API)
export const getListPrices = async () => {
  if (cachedPrices && (Date.now() - cacheTimestamp < CACHE_DURATION_MS)) {
    return cachedPrices;
  }

  if (pricesPromise) return pricesPromise;

  // Endpoint Original: /api/businesses/prices
  // Este endpoint devuelve la lista completa de países y banderas.
  pricesPromise = sendRequest('GET', '/api/businesses/prices')
    .then((responseBody) => {
      // Normalización: Vita a veces devuelve { data: [...] } o [...] directo
      const prices = responseBody.data || responseBody;
      cachedPrices = prices;
      cacheTimestamp = Date.now();
      pricesPromise = null;
      return cachedPrices;
    })
    .catch(error => {
      pricesPromise = null;
      console.warn("⚠️ Fallo /businesses/prices, intentando endpoint público de respaldo...");
      // Fallback Oculto: Si falla el de negocios, intentamos el público para no mostrar vacío
      // (Solo se usa si el principal falla)
      return getPublicPricesFallback();
    });

  return pricesPromise;
};

// Fallback de emergencia (Público)
const getPublicPricesFallback = async () => {
  try {
    const rates = await sendRequest('GET', '/prices');
    // Convertimos tasas simples a formato lista para que el frontend no rompa
    return Object.keys(rates).map(k => ({
      code: k.substring(0, 2).toUpperCase(),
      currency: k.toUpperCase(),
      name: k.toUpperCase()
    }));
  } catch (e) {
    throw e;
  }
};

// 2. REGLAS DE RETIRO
export const getWithdrawalRules = async () => {
  const res = await sendRequest('GET', '/api/businesses/withdrawal_rules');
  return res.data || res;
};

// 3. MÉTODOS DE PAGO
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
  return await sendRequest('POST', '/exchange/calculation', data);
};