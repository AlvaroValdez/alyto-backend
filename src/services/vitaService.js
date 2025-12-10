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

  return {
    'Content-Type': 'application/json',
    'x-login': vita.apiLogin,
    'x-trans-key': signature,
    'x-date': date,
  };
};

// --- 2. CLIENTE HTTP SEGURO ---
const sendRequest = async (method, endpoint, data = null) => {
  // Si vita.apiUrl ya termina en /api, concatenar /api/... duplicaría la ruta.
  const url = `${vita.apiUrl}${endpoint}`;

  const bodyString = data ? JSON.stringify(data) : '';
  const headers = getAuthHeaders(method, endpoint, bodyString);

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
    console.error(`[VitaService] Error en ${endpoint}:`, error.response?.data || error.message);
    throw error;
  }
};

// ==========================================
// ENDPOINTS DE NEGOCIO (RUTAS CORREGIDAS)
// ==========================================

// 1. OBTENER LISTA DE PRECIOS
export const getListPrices = async () => {
  if (cachedPrices && (Date.now() - cacheTimestamp < CACHE_DURATION_MS)) {
    return cachedPrices;
  }

  if (pricesPromise) return pricesPromise;

  // CORRECCIÓN: Quitamos '/api' del inicio porque vita.apiUrl ya lo trae
  pricesPromise = sendRequest('GET', '/businesses/prices')
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
  // CORRECCIÓN: /businesses/... en lugar de /api/businesses/...
  const res = await sendRequest('GET', '/businesses/withdrawal_rules');
  return res.data || res;
};

// 3. MÉTODOS DE PAGO (Pay-ins)
export const getPaymentMethods = async (country) => {
  const res = await sendRequest('GET', `/businesses/payment_methods/${country}`);
  return res.data || res;
};

// 4. CREAR RETIRO (Payouts - SALIDAS)
export const createWithdrawal = async (payload) => {
  return await sendRequest('POST', '/businesses/transactions', payload);
};

// 5. CREAR ORDEN DE PAGO (Redirect - ENTRADAS)
export const createPaymentOrder = async (payload) => {
  return await sendRequest('POST', '/businesses/payment_orders', payload);
};

// 6. EJECUTAR PAGO DIRECTO (Marca Blanca)
export const executeDirectPayment = async (data) => {
  const { uid, ...paymentDetails } = data;
  const payload = { payment_data: paymentDetails };

  return await sendRequest('POST', `/businesses/payment_orders/${uid}/direct_payment`, payload);
};
export const createDirectPaymentOrder = executeDirectPayment;

// 7. COTIZACIÓN (Calculadora)
export const getQuote = async (data) => {
  // Este endpoint suele estar fuera de /businesses, se mantiene en la raíz de api
  return await sendRequest('POST', '/exchange/calculation', data);
};