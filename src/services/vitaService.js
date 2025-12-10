import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// --- HELPER DE AUTENTICACIÓN ---
const getAuthHeaders = (method, urlPath, bodyString = '') => {
  if (!vita.apiSecret) {
    throw new Error("CONFIG ERROR: Falta VITA_SECRET_KEY.");
  }

  const date = Math.floor(Date.now() / 1000);

  // Firma HMAC-SHA256
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

  // Convertir body a string (si existe) para firma exacta
  // Si es GET, el body es vacío string ''
  const bodyString = data ? JSON.stringify(data) : '';

  const headers = getAuthHeaders(method, endpoint, bodyString);

  try {
    const config = { headers };

    let response;
    if (method === 'GET') {
      response = await axios.get(url, config);
    } else if (method === 'POST') {
      response = await axios.post(url, bodyString, config); // Enviamos string
    } else {
      // Soporte para otros métodos si fuera necesario
      response = await axios({ method, url, data: bodyString, headers });
    }

    return response.data;
  } catch (error) {
    console.error(`[VitaService] Error en ${endpoint}:`, error.response?.data || error.message);
    throw error;
  }
};

// --- FUNCIONES EXPORTADAS ---

// 1. Obtener Precios/Tasas (Usado en el Home)
export const getPrices = async () => {
  // Ajusta el endpoint según la doc de Vita (ej: /prices, /rates, /exchange/rates)
  // Asumimos '/prices' o '/exchange/rates'
  return await sendRequest('GET', '/prices');
};

// 2. Obtener Cotización (Calculator)
export const getQuote = async (data) => {
  // data suele ser { amount, currency, country, ... }
  return await sendRequest('POST', '/exchange/calculation', data);
};

// 3. Crear Retiro (Payout) - YA BLINDADO
export const createWithdrawal = async (data) => {
  return await sendRequest('POST', '/withdrawals', data);
};

// 4. Obtener Métodos de Pago (Pay-in)
export const getPaymentMethods = async (country = 'CL') => {
  return await sendRequest('GET', `/payment_methods?country=${country}`);
};

// 5. Crear Orden de Pago (Pay-in Redirect)
export const createPaymentOrder = async (data) => {
  return await sendRequest('POST', '/orders', data);
};

// 6. Crear Orden de Pago Directa (Marca Blanca)
export const createDirectPaymentOrder = async (data) => {
  return await sendRequest('POST', '/orders/direct', data);
};