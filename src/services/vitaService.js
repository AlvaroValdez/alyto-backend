import { client } from './vitaClient.js';
import Markup from '../models/Markup.js'; // Importación necesaria si usas getOrInit aquí

// ... (Variables de caché y getListPrices - Sin cambios) ...
let cachedPrices = null;
let cacheTimestamp = null;
const CACHE_DURATION_MS = 15 * 1000;
let pricesPromise = null;

export const getListPrices = async () => {
  if (cachedPrices && (Date.now() - cacheTimestamp < CACHE_DURATION_MS)) {
    console.log('⚡️ [vitaService] Devolviendo precios desde la caché.');
    return cachedPrices;
  }
  if (pricesPromise) return pricesPromise;

  console.log('⏳ [vitaService] Obteniendo nuevos precios desde Vita Wallet...');
  pricesPromise = client.get('/api/businesses/prices')
    .then(({ data }) => {
      cachedPrices = data;
      cacheTimestamp = Date.now();
      pricesPromise = null;
      return cachedPrices;
    })
    .catch(error => {
      pricesPromise = null;
      console.error('❌ [vitaService] Error precios:', error.message);
      throw error;
    });
  return pricesPromise;
};

export const getWithdrawalRules = async () => {
  const { data } = await client.get('/api/businesses/withdrawal_rules');
  return data;
};

export const createWithdrawal = async (payload) => {
  const { data } = await client.post('/api/businesses/transactions', payload);
  return data;
};

export const createPaymentOrder = async (payload) => {
  const { data } = await client.post('/api/businesses/payment_orders', payload);
  return data;
};

// --- FUNCIÓN CORREGIDA CON LOGS DETALLADOS ---
export const getPaymentMethods = async (country) => {
  const url = `/api/businesses/payment_methods/${country}`;
  console.log(`ℹ️ [vitaService] Llamando a: ${url}`);

  try {
    // --- CORRECCIÓN: Eliminamos 'data: {}' ---
    // Ahora que tienes permisos, la petición debe ser un GET limpio.
    // Mantenemos el header Content-Type porque la documentación lo pide explícitamente.
    const { data } = await client.get(url, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return data;

  } catch (error) {
    // ... (tu lógica de manejo de errores detallado se mantiene igual)
    console.error(`❌ [vitaService] Error al obtener métodos para ${country}:`);
    if (error.response) {
      console.error('STATUS:', error.response.status);
      console.error('DATA (Mensaje de Vita):', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('ERROR:', error.message);
    }
    throw error;
  }
};

export const executeDirectPayment = async (orderId, paymentData) => {
  const payload = { payment_data: paymentData };
  const { data } = await client.post(`/api/businesses/payment_orders/${orderId}/direct_payment`, payload);
  return data;
};