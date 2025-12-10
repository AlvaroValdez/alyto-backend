import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// --- VARIABLES DE CACHÉ ---
let cachedPrices = null;
let cacheTimestamp = null;
const CACHE_DURATION_MS = 15 * 1000;
let pricesPromise = null;

// --- 1. CONFIGURACIÓN DE URL ---
// Para evitar duplicidades tipo /api/api, limpiamos la URL base.
// Nos quedamos solo con el dominio (ej: https://api.vitawallet.io)
const getBaseUrl = () => {
  // Si la variable de entorno tiene /api al final, se lo quitamos para manejar rutas completas manualmente
  if (vita.apiUrl.endsWith('/api')) {
    return vita.apiUrl.slice(0, -4);
  }
  if (vita.apiUrl.endsWith('/api/')) {
    return vita.apiUrl.slice(0, -5);
  }
  return vita.apiUrl;
};

const API_DOMAIN = getBaseUrl(); // ej: https://api.vitawallet.io

// --- 2. CORE DE SEGURIDAD (BLINDADO) ---
const getAuthHeaders = (method, urlPath, bodyString = '') => {
  if (!vita.apiSecret) throw new Error("CONFIG ERROR: Falta VITA_SECRET_KEY.");

  const date = Math.floor(Date.now() / 1000);

  // CRÍTICO: Firmamos la ruta EXACTA que se envía (ej: /api/businesses/prices)
  const signature = crypto.createHmac('sha256', vita.apiSecret).update(bodyString).digest('hex');

  const headers = {
    'x-login': vita.apiLogin,
    'x-trans-key': signature,
    'x-date': date,
  };

  // En GET no enviamos Content-Type para evitar errores 401 en algunos firewalls
  if (method === 'POST' || (method !== 'GET' && bodyString)) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
};

// --- 3. CLIENTE HTTP ---
const sendRequest = async (method, endpoint, data = null) => {
  // endpoint debe venir completo, ej: '/api/businesses/prices'
  const url = `${API_DOMAIN}${endpoint}`;

  // Body vacío exacto para GET
  const bodyString = data ? JSON.stringify(data) : '';

  // Firmamos el endpoint COMPLETO (incluyendo /api)
  const headers = getAuthHeaders(method, endpoint, bodyString);

  try {
    const config = { headers };
    let response;

    if (method === 'GET') {
      response = await axios.get(url, config);
    } else if (method === 'POST') {
      response = await axios.post(url, bodyString, config);
    }

    // Axios devuelve { data: ... }, Vita Business suele devolver el contenido directo o en .data
    return response.data;

  } catch (error) {
    // Log detallado para depuración
    console.error(`❌ [VitaService] Error ${error.response?.status || 'Unknown'} en ${endpoint}`);
    if (error.response?.data) {
      console.error('>> Detalle Vita:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
};

// ==========================================
// ENDPOINTS (USANDO RUTAS COMPLETAS /api/...)
// ==========================================

// 1. OBTENER LISTA DE PRECIOS
export const getListPrices = async () => {
  if (cachedPrices && (Date.now() - cacheTimestamp < CACHE_DURATION_MS)) {
    return cachedPrices;
  }

  if (pricesPromise) return pricesPromise;

  // Usamos la ruta completa tal como funcionaba en tu código antiguo
  pricesPromise = sendRequest('GET', '/api/businesses/prices')
    .then((responseBody) => {
      const prices = responseBody.data || responseBody;
      cachedPrices = prices;
      cacheTimestamp = Date.now();
      pricesPromise = null;
      return cachedPrices;
    })
    .catch(error => {
      pricesPromise = null;
      throw error;
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
  // La calculadora suele estar en la ruta base
  return await sendRequest('POST', '/api/exchange/calculation', data);
};