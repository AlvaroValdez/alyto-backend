import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// --- VARIABLES DE CACHÉ ---
let cachedPrices = null;
let cacheTimestamp = null;
const CACHE_DURATION_MS = 15 * 1000;
let pricesPromise = null;

// --- 1. NORMALIZACIÓN DE LA URL BASE ---
// Recuperamos la raíz del dominio para evitar problemas de dobles "/api" o falta de ellos.
const getApiDomain = () => {
  let url = vita.apiUrl;
  // Quitamos slash final si existe
  if (url.endsWith('/')) url = url.slice(0, -1);
  // Si la variable de entorno termina en /api, lo quitamos para trabajar desde la raíz limpia
  if (url.endsWith('/api')) url = url.slice(0, -4);

  return url; // Ej: https://api.vitawallet.io
};

const API_DOMAIN = getApiDomain();

// --- 2. CORE DE SEGURIDAD (BLINDADO) ---
const getAuthHeaders = (method, bodyString = '') => {
  if (!vita.apiSecret) throw new Error("CONFIG ERROR: Falta VITA_SECRET_KEY.");

  const date = Math.floor(Date.now() / 1000);

  // LA CLAVE DEL ÉXITO: 
  // Para POST: Firmamos el JSON stringificado.
  // Para GET: Firmamos un string vacío "".
  const signature = crypto.createHmac('sha256', vita.apiSecret).update(bodyString).digest('hex');

  const headers = {
    'x-login': vita.apiLogin,
    'x-trans-key': signature,
    'x-date': date,
    'Content-Type': 'application/json' // Vita suele requerirlo siempre, incluso en GET
  };

  return headers;
};

// --- 3. CLIENTE HTTP ---
const sendRequest = async (method, endpoint, data = null) => {
  // endpoint debe ser la ruta completa: /api/businesses/prices
  const url = `${API_DOMAIN}${endpoint}`;

  // Body vacío exacto para GET
  const bodyString = data ? JSON.stringify(data) : '';

  // Generamos headers firmando el bodyString
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
    // Log específico para detectar si es error de URL o de Permisos
    console.error(`❌ [VitaService] Error ${error.response?.status} en ${url}`);
    if (error.response?.data) {
      console.error('>> Respuesta Vita:', JSON.stringify(error.response.data));
    }
    throw error;
  }
};

// ==========================================
// ENDPOINTS DE NEGOCIO (RUTAS COMPLETAS RESTAURADAS)
// ==========================================

// 1. OBTENER LISTA DE PRECIOS
// Usamos '/api/businesses/prices' que es la ruta que funcionaba en tu código original
export const getListPrices = async () => {
  if (cachedPrices && (Date.now() - cacheTimestamp < CACHE_DURATION_MS)) {
    return cachedPrices;
  }
  if (pricesPromise) return pricesPromise;

  pricesPromise = sendRequest('GET', '/api/businesses/prices')
    .then((responseBody) => {
      // Normalización: Vita Business a veces devuelve { data: [...] } y a veces [...]
      const prices = responseBody.data || responseBody;

      // LOG DE DIAGNÓSTICO
      if (Array.isArray(prices)) {
        console.log(`✅ [VitaService] Precios cargados: ${prices.length} países encontrados.`);
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

// 4. CREAR RETIRO (Payouts - SALIDAS)
export const createWithdrawal = async (payload) => {
  return await sendRequest('POST', '/api/businesses/transactions', payload);
};

// 5. CREAR ORDEN DE PAGO (Redirect - ENTRADAS)
export const createPaymentOrder = async (payload) => {
  return await sendRequest('POST', '/api/businesses/payment_orders', payload);
};

// 6. EJECUTAR PAGO DIRECTO (Marca Blanca)
export const executeDirectPayment = async (data) => {
  const { uid, ...paymentDetails } = data;
  const payload = { payment_data: paymentDetails };
  return await sendRequest('POST', `/api/businesses/payment_orders/${uid}/direct_payment`, payload);
};
export const createDirectPaymentOrder = executeDirectPayment;

// 7. COTIZACIÓN (Calculadora)
export const getQuote = async (data) => {
  // Ruta estándar de calculadora
  return await sendRequest('POST', '/api/exchange/calculation', data);
};