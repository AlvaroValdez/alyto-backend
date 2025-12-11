import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// --- CONFIGURACIÓN Y CACHÉ ---
let cachedPrices = null;
let cacheTimestamp = null;
const CACHE_DURATION_MS = 60 * 1000;
let pricesPromise = null;

// --- 1. NORMALIZACIÓN DE URL ---
const getApiDomain = () => {
  let url = vita.apiUrl;
  // Limpieza robusta de slashes y sufijos
  if (url.endsWith('/')) url = url.slice(0, -1);
  if (url.endsWith('/api')) url = url.slice(0, -4);
  return url;
};
const API_DOMAIN = getApiDomain();

// --- 2. CORE DE SEGURIDAD (CORREGIDO SEGÚN IMAGEN DE KEYS) ---
const getAuthHeaders = (method, endpoint, bodyString = '') => {

  // 1. Validamos que existan las credenciales
  if (!vita.apiLogin || !vita.apiKey) {
    throw new Error("CONFIG ERROR: Faltan credenciales VITA_LOGIN o VITA_TRANS_KEY.");
  }

  const date = Math.floor(Date.now() / 1000);

  // 2. HEADER BASE
  // Según tu imagen, 'apiKey' es el valor 's+OtCG...'. 
  // La mayoría de endpoints Business v2 aceptan este valor directo.
  const headers = {
    'x-login': vita.apiLogin,     // Tu ID de Login
    'x-trans-key': vita.apiKey,   // Tu llave pública (la corta)
    'x-date': date,
    'Content-Type': 'application/json'
  };

  // 3. FIRMA HMAC (SOLO SI ES NECESARIA)
  // Algunos endpoints sensibles de POST podrían requerir que 'x-trans-key' sea una firma
  // en lugar de la llave estática. Si el GET /prices sigue fallando, es poco probable
  // que sea por esto, pero dejo la lógica lista por si acaso necesitamos cambiar a modo firma.

  /* * NOTA: Si en el futuro un endpoint POST da 401, descomenta esto:
   * const signature = crypto.createHmac('sha256', vita.apiSecret).update(bodyString).digest('hex');
   * headers['x-signature'] = signature; // O reemplazar x-trans-key según doc específica
   */

  return headers;
};

// --- 3. CLIENTE HTTP ---
const sendRequest = async (method, endpoint, data = null) => {
  const url = `${API_DOMAIN}${endpoint}`;

  // Aseguramos que body sea string vacío si es null, para evitar problemas de firmas futuras
  const bodyString = data ? JSON.stringify(data) : '';

  try {
    const headers = getAuthHeaders(method, endpoint, bodyString);
    const config = { headers };

    let response;
    console.log(`📡 [VitaService] Conectando a ${method} ${url}...`);

    if (method === 'GET') {
      response = await axios.get(url, config);
    } else if (method === 'POST') {
      response = await axios.post(url, bodyString, config);
    }

    return response.data;

  } catch (error) {
    // Log detallado para depuración
    const status = error.response?.status;
    const urlError = error.config?.url || url;

    console.error(`❌ [VitaService] Error ${status} en ${urlError}`);

    if (status === 401) {
      console.error("🔒 AUTH FAILED: Verifica que VITA_TRANS_KEY en .env sea la llave corta (terminada en =)");
      console.error("   Headers enviados (Login):", vita.apiLogin);
      // No imprimimos la key completa por seguridad, solo los ultimos caracteres
      console.error("   Headers enviados (Key fin):", "..." + vita.apiKey?.slice(-4));
    }

    if (error.response?.data) {
      console.error('>> Detalle Vita:', JSON.stringify(error.response.data, null, 2));
    }

    throw error;
  }
};

// ==========================================
// ENDPOINTS
// ==========================================

export const getListPrices = async () => {
  if (cachedPrices && (Date.now() - cacheTimestamp < CACHE_DURATION_MS)) {
    return cachedPrices;
  }
  if (pricesPromise) return pricesPromise;

  pricesPromise = sendRequest('GET', '/api/businesses/prices')
    .then((rawResponse) => {
      const cleanPrices = normalizePrices(rawResponse);
      if (cleanPrices.length > 0) {
        console.log(`✅ [VitaService] ${cleanPrices.length} precios obtenidos.`);
        cachedPrices = cleanPrices;
        cacheTimestamp = Date.now();
        pricesPromise = null;
        return cleanPrices;
      } else {
        console.warn("⚠️ [VitaService] Respuesta vacía de Vita.");
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

// ... Resto de funciones (normalizePrices, getWithdrawalRules, etc) IGUAL QUE ANTES ...
// Solo asegúrate de copiar la función normalizePrices del chat anterior si no la tienes.

// Función auxiliar necesaria (copiada de tu versión anterior para que no falte)
const normalizePrices = (responseData) => {
  const rawData = responseData.data || responseData;
  const normalized = [];
  if (Array.isArray(rawData)) {
    rawData.forEach(item => {
      const code = item.code || item.currency || item.iso_code;
      const rate = item.rate || item.price || item.value;
      if (code && rate) {
        normalized.push({ code: String(code).toUpperCase(), rate: Number(rate) });
      }
    });
    return normalized;
  }
  return [];
};

export const getWithdrawalRules = async () => sendRequest('GET', '/api/businesses/withdrawal_rules');
export const getPaymentMethods = async (country) => sendRequest('GET', `/api/businesses/payment_methods/${country}`);
export const createWithdrawal = async (payload) => sendRequest('POST', '/api/businesses/transactions', payload);
export const createPaymentOrder = async (payload) => sendRequest('POST', '/api/businesses/payment_orders', payload);
export const executeDirectPayment = async (data) => {
  const { uid, ...paymentDetails } = data;
  return sendRequest('POST', `/api/businesses/payment_orders/${uid}/direct_payment`, { payment_data: paymentDetails });
};
export const createDirectPaymentOrder = executeDirectPayment;
export const getQuote = async (data) => sendRequest('POST', '/api/exchange/calculation', data);