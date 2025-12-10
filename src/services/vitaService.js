import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// --- VARIABLES DE CACHÉ (Originales) ---
let cachedPrices = null;
let cacheTimestamp = null;
const CACHE_DURATION_MS = 15 * 1000;
let pricesPromise = null;

// --- 1. NORMALIZACIÓN DE URL BASE ---
// Queremos llegar a la raíz: "https://api.vitawallet.io"
// para poder concatenar rutas completas como "/api/businesses/prices"
const getApiDomain = () => {
  let url = vita.apiUrl;
  // Si termina en slash, lo quitamos
  if (url.endsWith('/')) url = url.slice(0, -1);
  // Si termina en /api, lo quitamos para trabajar desde la raíz
  if (url.endsWith('/api')) url = url.slice(0, -4);
  return url;
};

const API_DOMAIN = getApiDomain();

// --- 2. CORE DE SEGURIDAD (BLINDADO) ---
const getAuthHeaders = (method, urlPath, bodyString = '') => {
  if (!vita.apiSecret) throw new Error("CONFIG ERROR: Falta VITA_SECRET_KEY.");

  const date = Math.floor(Date.now() / 1000);

  // CRÍTICO: Vita valida que firmemos la ruta completa (ej: /api/businesses/prices)
  const signature = crypto.createHmac('sha256', vita.apiSecret).update(bodyString).digest('hex');

  const headers = {
    'Content-Type': 'application/json',
    'x-login': vita.apiLogin,
    'x-trans-key': signature,
    'x-date': date,
  };

  // Corrección para GET: Eliminar Content-Type si no hay cuerpo, 
  // esto evita conflictos con algunos firewalls de Vita en peticiones de lectura.
  if (method === 'GET') {
    delete headers['Content-Type'];
  }

  return headers;
};

// --- 3. CLIENTE HTTP ---
const sendRequest = async (method, endpoint, data = null) => {
  // endpoint debe ser la ruta completa: /api/businesses/prices
  const url = `${API_DOMAIN}${endpoint}`;

  // Body vacío exacto para GET
  const bodyString = data ? JSON.stringify(data) : '';

  // Firmamos el endpoint EXACTO que estamos pidiendo
  const headers = getAuthHeaders(method, endpoint, bodyString);

  try {
    const config = { headers };
    let response;

    if (method === 'GET') {
      response = await axios.get(url, config);
    } else if (method === 'POST') {
      response = await axios.post(url, bodyString, config);
    }

    // Axios devuelve { data: ... }. Vita a veces anida data dentro de data.
    return response.data;

  } catch (error) {
    console.error(`❌ [VitaService] Error en ${endpoint}: ${error.message}`);
    if (error.response) {
      console.error('>> Status:', error.response.status);
      console.error('>> Response:', JSON.stringify(error.response.data));
    }
    throw error;
  }
};

// ==========================================
// ENDPOINTS DE NEGOCIO (RUTAS ORIGINALES)
// ==========================================

// 1. OBTENER LISTA DE PRECIOS
export const getListPrices = async () => {
  if (cachedPrices && (Date.now() - cacheTimestamp < CACHE_DURATION_MS)) {
    return cachedPrices;
  }
  if (pricesPromise) return pricesPromise;

  // RUTAS COMPLETAS: Tal como en tu código original
  pricesPromise = sendRequest('GET', '/api/businesses/prices')
    .then((responseBody) => {
      // Normalización: A veces viene directo el array, a veces en .data
      const prices = Array.isArray(responseBody) ? responseBody : (responseBody.data || []);

      // INYECCIÓN MANUAL BOLIVIA (Solo si no viene en la lista)
      // Esto asegura tu canal manual sin romper la lista oficial
      if (Array.isArray(prices) && !prices.find(p => p.code === 'BO')) {
        prices.push({
          code: 'BO',
          name: 'Bolivia',
          currency: 'BOB',
          flag: '🇧🇴', // O la URL de la bandera si Vita usa URLs
          manual: true
        });
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
  // Este endpoint es el que requería la firma especial (POST)
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
  // Endpoint de cálculo (suele estar fuera de /businesses)
  return await sendRequest('POST', '/api/exchange/calculation', data);
};