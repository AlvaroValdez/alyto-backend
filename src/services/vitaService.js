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
  if (!vita.apiLogin || !vita.apiKey) {
    throw new Error("CONFIG ERROR: Faltan credenciales VITA_LOGIN o VITA_TRANS_KEY.");
  }

  const date = Math.floor(Date.now() / 1000);

  const headers = {
    'x-login': vita.apiLogin,
    'x-trans-key': vita.apiKey,
    'x-date': date,
    'Content-Type': 'application/json',
    // AGREGADO: Enviar también como Bearer/Basic por si Stage lo requiere
    'Authorization': vita.apiKey
  };

  // Log de seguridad para verificar que Render inyectó la variable (Solo imprimimos los últimos 4 chars)
  const maskedKey = vita.apiKey ? `...${vita.apiKey.slice(-4)}` : 'UNDEFINED';
  console.log(`🔑 [Auth Debug] Usando Key terminada en: ${maskedKey}`);

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
// ENDPOINTS PÚBLICOS DEL SERVICIO
// ==========================================

export const getListPrices = async () => {
  // ... lógica de caché ...

  // CAMBIO CRÍTICO: Usamos '/api/prices' en lugar de '/api/businesses/prices'
  // Este endpoint suele aceptar API Keys simples o incluso acceso público.
  pricesPromise = sendRequest('GET', '/api/prices')
    .then((rawResponse) => {
      // Nuestra función normalizePrices es inteligente y detectará el formato automáticamente
      const cleanPrices = normalizePrices(rawResponse);

      if (cleanPrices.length > 0) {
        console.log(`✅ [VitaService] ${cleanPrices.length} precios obtenidos desde /api/prices.`);
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