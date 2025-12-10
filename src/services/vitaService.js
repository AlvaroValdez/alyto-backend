import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// --- HELPER DE AUTENTICACIÓN (BLINDADO) ---
const getAuthHeaders = (method, urlPath, bodyString = '') => {
  if (!vita.apiSecret) {
    throw new Error("CONFIG ERROR: Falta VITA_SECRET_KEY en variables de entorno.");
  }

  const date = Math.floor(Date.now() / 1000);

  // Firma HMAC-SHA256 usando el bodyString exacto
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

// --- HELPER GENÉRICO DE PETICIÓN ---
const sendRequest = async (method, endpoint, data = null) => {
  const url = `${vita.apiUrl}${endpoint}`;

  // Convertir body a string (si existe) UNA SOLA VEZ para firma y envío
  const bodyString = data ? JSON.stringify(data) : '';

  const headers = getAuthHeaders(method, endpoint, bodyString);

  try {
    const config = { headers };

    let response;
    if (method === 'GET') {
      response = await axios.get(url, config);
    } else if (method === 'POST') {
      // Importante: Enviamos el bodyString, no el objeto data
      response = await axios.post(url, bodyString, config);
    } else {
      response = await axios({ method, url, data: bodyString, headers });
    }

    return response.data;
  } catch (error) {
    console.error(`[VitaService] Error en ${endpoint}:`, error.response?.data || error.message);
    throw error;
  }
};

// --- FUNCIONES EXPORTADAS (NOMBRES COMPATIBLES) ---

// 1. Obtener Lista de Precios (Corregido: getListPrices)
export const getListPrices = async () => {
  // Usamos el endpoint de precios (ajusta si Vita usa /rates o /prices)
  return await sendRequest('GET', '/prices');
};

// 2. Obtener Cotización
export const getQuote = async (data) => {
  return await sendRequest('POST', '/exchange/calculation', data);
};

// 3. Crear Retiro (Withdrawal)
export const createWithdrawal = async (data) => {
  return await sendRequest('POST', '/withdrawals', data);
};

// 4. Obtener Métodos de Pago
export const getPaymentMethods = async (country = 'CL') => {
  return await sendRequest('GET', `/payment_methods?country=${country}`);
};

// 5. Crear Orden de Pago (Redirect)
export const createPaymentOrder = async (data) => {
  return await sendRequest('POST', '/orders', data);
};

// 6. Crear Orden de Pago Directa
export const createDirectPaymentOrder = async (data) => {
  return await sendRequest('POST', '/orders/direct', data);
};