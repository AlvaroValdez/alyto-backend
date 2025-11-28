// backend/src/services/vitaService.js
// Fuente Vita: GET /api/businesses/prices, GET /api/businesses/withdrawal_rules, POST /api/businesses/transactions
// Justificación: centralizamos todo en precios y reglas; payment_methods/:country ya no existe.
import { client } from './vitaClient.js';

// --- LÓGICA DE CACHÉ PARA PRECIOS ---
let cachedPrices = null;
let cacheTimestamp = null;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutos

// Variables para manejar la concurrencia al buscar precios
let pricesPromise = null;

export const getListPrices = async () => {
  // 1. Devolver desde caché si es válida
  if (cachedPrices && (Date.now() - cacheTimestamp < CACHE_DURATION_MS)) {
    console.log('⚡️ [vitaService] Devolviendo precios desde la caché.');
    return cachedPrices;
  }

  // 2. Si ya hay una promesa de búsqueda en curso, devolver esa promesa
  //    Esto evita que múltiples peticiones simultáneas llamen a Vita.
  if (pricesPromise) {
    console.log('🔄 [vitaService] Petición de precios ya en curso. Esperando resultado...');
    return pricesPromise;
  }

  // 3. Si no hay caché ni promesa, iniciar una nueva búsqueda
  console.log('⏳ [vitaService] Obteniendo nuevos precios desde Vita Wallet...');

  // Guardamos la promesa de la llamada a la API
  pricesPromise = client.get('/api/businesses/prices')
    .then(({ data }) => {
      cachedPrices = data;
      cacheTimestamp = Date.now();
      pricesPromise = null; // Limpiamos la promesa una vez resuelta
      console.log('✅ [vitaService] Precios actualizados y cacheados.');
      return cachedPrices;
    })
    .catch(error => {
      pricesPromise = null; // Limpiamos la promesa también en caso de error
      console.error('❌ [vitaService] Error al obtener precios de Vita:', error);
      throw error; // Propagamos el error
    });

  return pricesPromise; // Devuelve la promesa
};

// --- FUNCIÓN CORREGIDA ---
export const getWithdrawalRules = async () => {
  console.log('ℹ️ [vitaService] Obteniendo withdrawal rules desde Vita Wallet...');
  const { data } = await client.get('/api/businesses/withdrawal_rules');
  return data;
};

export const createWithdrawal = async (payload) => {
  const { data } = await client.post('/api/businesses/transactions', payload);
  return data;
};

// --- NUEVA FUNCIÓN PARA PAY-IN ---
/**
 * Crea una orden de pago en Vita Wallet.
 * @param {object} payload - Debe contener amount, country_iso_code, issue, success_redirect_url.
 * @returns {Promise<object>} La respuesta de la API de Vita.
 */
export const createPaymentOrder = async (payload) => {
  console.log('💰 [vitaService] Creando orden de pago con payload:', payload);
  const { data } = await client.post('/api/businesses/payment_orders', payload);
  return data;
};

// --- NUEVAS FUNCIONES DIRECT PAYMENT (Basado en PDF v2) ---

/**
 * Obtiene los métodos de pago disponibles para un país (Direct Payment).
 * GET /api/businesses/payment_methods/{country}
 */
export const getPaymentMethods = async (country) => {
  console.log(`ℹ️ [vitaService] Obteniendo métodos de pago para: ${country}`);
  // Simplemente hacemos el GET. Axios y el interceptor se encargan del resto.
  const { data } = await client.get(`/api/businesses/payment_methods/${country}`);
  return data;
};

/**
 * Ejecuta el pago directo sobre una orden existente.
 * POST /api/businesses/payment_orders/{id}/direct_payment
 */
export const executeDirectPayment = async (orderId, paymentData) => {
  console.log(`💰 [vitaService] Ejecutando pago directo para orden ${orderId}`, paymentData);
  // La estructura según el PDF es { payment_data: { ... } }
  const payload = { payment_data: paymentData };
  const { data } = await client.post(`/api/businesses/payment_orders/${orderId}/direct_payment`, payload);
  return data;
};

export default {
  getListPrices,
  getWithdrawalRules,
  createWithdrawal,
  createPaymentOrder,
  getPaymentMethods,   // <-- Nuevo
  executeDirectPayment // <-- Nuevo
};