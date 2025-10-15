// backend/src/services/vitaService.js
// Fuente Vita: GET /api/businesses/prices, GET /api/businesses/withdrawal_rules, POST /api/businesses/transactions
// Justificación: centralizamos todo en precios y reglas; payment_methods/:country ya no existe.
import { client } from './vitaClient.js';

// --- LÓGICA DE CACHÉ PARA PRECIOS ---
let cachedPrices = null;
let cacheTimestamp = null;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutos

export const getListPrices = async () => {
  if (cachedPrices && (Date.now() - cacheTimestamp < CACHE_DURATION_MS)) {
    console.log('⚡️ [vitaService] Devolviendo precios desde la caché.');
    return cachedPrices;
  }

  console.log('⏳ [vitaService] Obteniendo nuevos precios desde Vita Wallet...');
  const { data } = await client.get('/api/businesses/prices');
  cachedPrices = data;
  cacheTimestamp = Date.now();
  return cachedPrices;
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

export default {
  getListPrices,
  getWithdrawalRules,
  createWithdrawal,
  createPaymentOrder, // <-- Exportamos la nueva función
};