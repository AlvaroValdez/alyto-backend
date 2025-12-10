import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// --- VARIABLES DE CACHÉ ---
let cachedPrices = null;
let cacheTimestamp = null;
const CACHE_DURATION_MS = 15 * 1000;
let pricesPromise = null;

// --- 1. NORMALIZACIÓN DE LA URL BASE ---
const getApiDomain = () => {
  let url = vita.apiUrl;
  if (url.endsWith('/')) url = url.slice(0, -1);
  if (url.endsWith('/api')) url = url.slice(0, -4);
  return url;
};

const API_DOMAIN = getApiDomain();

// --- 2. CORE DE SEGURIDAD (CORREGIDO) ---
const getAuthHeaders = (method, bodyString = '') => {
  // Asegúrate de tener vita.apiKey (la pública) y vita.apiSecret (si usas firma para POST)
  // Si en tu env solo tienes una llave, úsala aquí.
  const apiKey = vita.apiKey || vita.apiSecret;

  if (!apiKey) throw new Error("CONFIG ERROR: Falta VITA_API_KEY / VITA_SECRET_KEY.");

  const date = Math.floor(Date.now() / 1000);

  // CORRECCIÓN CRÍTICA PARA ERROR 401:
  // La mayoría de endpoints GET de Vita Wallet (prices, rules) esperan la API KEY directa.
  // Solo algunos endpoints POST de alta seguridad requieren firma HMAC.

  let transKey = apiKey;

  // OPCIONAL: Si tu integración requiere firma SOLO en POST, descomenta esto:
  /*
  if (method === 'POST' && vita.apiSecret) {
     transKey = crypto.createHmac('sha256', vita.apiSecret).update(bodyString).digest('hex');
  }
  */

  const headers = {
    'x-login': vita.apiLogin,
    'x-trans-key': transKey, // Enviamos la llave real, no el hash
    'x-date': date,
    'Content-Type': 'application/json'
  };

  return headers;
};

// --- 3. CLIENTE HTTP ---
const sendRequest = async (method, endpoint, data = null) => {
  const url = `${API_DOMAIN}${endpoint}`;

  // Body vacío para GET
  const bodyString = data ? JSON.stringify(data) : '';

  // Generamos headers
  const headers = getAuthHeaders(method, bodyString);

  try {
    const config = { headers };
    let response;

    if (method === 'GET') {
      response = await axios.get(url, config);
    } else if (method === 'POST') {
      response = await axios.post(url, bodyString, config); // Enviamos bodyString para asegurar consistencia
    }

    return response.data;

  } catch (error) {
    // Mejoramos el log para ver qué falló realmente
    console.error(`❌ [VitaService] Error ${error.response?.status} en ${method} ${url}`);
    if (error.response?.data) {
      // Hacemos log del error detallado que devuelve Vita
      console.error('>> Detalle Error Vita:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
};

// ==========================================
// ENDPOINTS DE NEGOCIO
// ==========================================

// 1. OBTENER LISTA DE PRECIOS
export const getListPrices = async () => {
  if (cachedPrices && (Date.now() - cacheTimestamp < CACHE_DURATION_MS)) {
    return cachedPrices;
  }
  if (pricesPromise) return pricesPromise;

  pricesPromise = sendRequest('GET', '/api/businesses/prices')
    .then((responseBody) => {
      const prices = responseBody.data || responseBody;

      if (Array.isArray(prices)) {
        console.log(`✅ [VitaService] Precios cargados: ${prices.length} países.`);
      } else {
        console.warn("⚠️ [VitaService] Formato inesperado en precios:", prices);
      }

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

// 2. REGLAS DE RETIRO (Referencia cruzada solicitada)
// Si prices falla, este también debería fallar con la lógica anterior.
// Con la corrección de enviar la KEY real, ambos deberían funcionar.
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

// 5. CREAR ORDEN DE PAGO (Pay-ins)
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