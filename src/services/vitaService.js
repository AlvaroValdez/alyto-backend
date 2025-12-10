import { client } from './vitaClient.js';
import Markup from '../models/Markup.js'; // Importación necesaria si usas getOrInit aquí
import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js'

// ... (Variables de caché y getListPrices - Sin cambios) ...
let cachedPrices = null;
let cacheTimestamp = null;
const CACHE_DURATION_MS = 15 * 1000;
let pricesPromise = null;

// Helper para generar headers de autenticación
const getAuthHeaders = (method, urlPath, bodyString = '') => {
  // 1. CHEQUEO DE SEGURIDAD
  if (!vita.apiSecret) {
    throw new Error("CONFIG ERROR: Falta VITA_SECRET_KEY en las variables de entorno. No se puede firmar la petición.");
  }

  // Timestamp Unix actual (segundos)
  const date = Math.floor(Date.now() / 1000);

  // Generar Firma HMAC-SHA256
  const signature = crypto
    .createHmac('sha256', vita.apiSecret)
    .update(bodyString)
    .digest('hex');

  return {
    'Content-Type': 'application/json',
    'x-login': vita.apiLogin,
    'x-trans-key': signature,
    'x-date': date,
  };
};

export const createWithdrawal = async (data) => {
  const url = `${vita.apiUrl}/withdrawals`;

  // 1. CONVERTIR A STRING UNA SOLA VEZ (CRÍTICO PARA LA FIRMA)
  // Esto asegura que lo que firmamos es idéntico a lo que enviamos
  const bodyString = JSON.stringify(data);

  // 2. Generar headers usando ese string exacto
  const headers = getAuthHeaders('POST', '/withdrawals', bodyString);

  try {
    // 3. Enviar el string directamente a Axios, no el objeto
    const response = await axios.post(url, bodyString, { headers });
    return response.data;
  } catch (error) {
    console.error('[VitaService] Error:', error.response?.data || error.message);
    throw error;
  }
};

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

export const createPaymentOrder = async (payload) => {
  const { data } = await client.post('/api/businesses/payment_orders', payload);
  return data;
};

// --- FUNCIÓN CORREGIDA CON LOGS DETALLADOS ---
export const getPaymentMethods = async (country) => {
  // URL del endpoint
  const url = `/api/businesses/payment_methods/${country}`;
  console.log(`ℹ️ [vitaService] Obteniendo métodos de pago para: ${country}`);

  try {
    // CORRECCIÓN: Eliminamos los headers manuales.
    // Dejamos que Axios y el interceptor manejen la firma como en getListPrices.
    const { data } = await client.get(url);

    return data;

  } catch (error) {
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