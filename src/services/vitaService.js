import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// --- VARIABLES DE CACHÉ (Restauradas) ---
let cachedPrices = null;
let cacheTimestamp = null;
const CACHE_DURATION_MS = 15 * 1000; // 15 segundos
let pricesPromise = null;

// --- 1. CORE DE SEGURIDAD (NO TOCAR) ---
// Esto es lo que arregló el error "Invalid Signature" en los pagos.
const getAuthHeaders = (method, urlPath, bodyString = '') => {
  if (!vita.apiSecret) throw new Error("CONFIG ERROR: Falta VITA_SECRET_KEY.");

  const date = Math.floor(Date.now() / 1000);
  // Firma HMAC-SHA256 estricta
  const signature = crypto.createHmac('sha256', vita.apiSecret).update(bodyString).digest('hex');

  return {
    'Content-Type': 'application/json',
    'x-login': vita.apiLogin,
    'x-trans-key': signature,
    'x-date': date,
  };
};

// --- 2. CLIENTE HTTP SEGURO ---
// Reemplaza a tu antiguo 'vitaClient.js' para inyectar la firma correcta en cada petición.
const sendRequest = async (method, endpoint, data = null) => {
  const url = `${vita.apiUrl}${endpoint}`;

  // Convertir a string UNA SOLA VEZ para asegurar que la firma coincida con lo enviado
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

    // La API de Business suele devolver { data: [...] } o a veces directo.
    // Axios ya devuelve { data: { data: [...] } }. Retornamos el body de la respuesta HTTP.
    return response.data;

  } catch (error) {
    console.error(`[VitaService] Error en ${endpoint}:`, error.response?.data || error.message);
    throw error;
  }
};

// ==========================================
// ENDPOINTS DE NEGOCIO (RESTAURADOS)
// ==========================================

// 1. OBTENER LISTA DE PRECIOS (Business API)
export const getListPrices = async () => {
  // Lógica de caché para no saturar
  if (cachedPrices && (Date.now() - cacheTimestamp < CACHE_DURATION_MS)) {
    return cachedPrices;
  }

  if (pricesPromise) return pricesPromise;

  // Usamos el endpoint ORIGINAL que devuelve la lista de países completa
  pricesPromise = sendRequest('GET', '/api/businesses/prices')
    .then((responseBody) => {
      // Nota: A veces la API devuelve { data: [...] }, a veces el array directo.
      // Normalizamos aquí para que tu frontend reciba siempre el array.
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
  // Retorna { data: [...] } usualmente
  const res = await sendRequest('GET', '/api/businesses/withdrawal_rules');
  return res.data || res;
};

// 3. MÉTODOS DE PAGO (Pay-ins)
export const getPaymentMethods = async (country) => {
  // Endpoint original
  const res = await sendRequest('GET', `/api/businesses/payment_methods/${country}`);
  return res.data || res;
};

// 4. CREAR RETIRO (Payouts - SALIDAS)
// Este usa el mecanismo seguro 'sendRequest' para evitar el error 303
export const createWithdrawal = async (payload) => {
  return await sendRequest('POST', '/api/businesses/transactions', payload);
};

// 5. CREAR ORDEN DE PAGO (Redirect - ENTRADAS)
export const createPaymentOrder = async (payload) => {
  return await sendRequest('POST', '/api/businesses/payment_orders', payload);
};

// 6. EJECUTAR PAGO DIRECTO (Marca Blanca)
export const executeDirectPayment = async (data) => {
  // El controller nos envía { uid: 'order-id', ...datos }. Separamos.
  const { uid, ...paymentDetails } = data;

  // Reconstruimos el payload como lo exige la doc de Business: { payment_data: { ... } }
  const payload = { payment_data: paymentDetails };

  return await sendRequest('POST', `/api/businesses/payment_orders/${uid}/direct_payment`, payload);
};
// Alias
export const createDirectPaymentOrder = executeDirectPayment;


// 7. COTIZACIÓN (Calculadora)
export const getQuote = async (data) => {
  // Si usabas un endpoint de negocio para esto, cámbialo aquí. 
  // Si no, el estándar funciona.
  return await sendRequest('POST', '/exchange/calculation', data);
};