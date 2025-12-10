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

// --- FUNCIONES EXPORTADAS ---

// 1. Obtener Lista de Precios
export const getListPrices = async () => {
  return await sendRequest('GET', '/prices');
};

// 2. Obtener Reglas de Retiro (ESTA ES LA QUE FALTABA)
export const getWithdrawalRules = async (country) => {
  // Si se pasa un país, lo agregamos como query param, si no, traemos todas
  const endpoint = country ? `/withdrawals/rules/${country}` : '/withdrawals/rules';
  // Nota: Ajusta el endpoint '/withdrawals/rules' si la doc de Vita dice otra cosa (ej: /banks/rules)
  // Usualmente es GET /withdrawals/rules/{iso_code} o ?country={iso_code}
  // Probaremos la ruta estándar:
  return await sendRequest('GET', endpoint);
};

// 3. Obtener Cotización
export const getQuote = async (data) => {
  return await sendRequest('POST', '/exchange/calculation', data);
};

// 4. Crear Retiro (Withdrawal)
export const createWithdrawal = async (data) => {
  return await sendRequest('POST', '/withdrawals', data);
};

// 5. Obtener Métodos de Pago
export const getPaymentMethods = async (country = 'CL') => {
  return await sendRequest('GET', `/payment_methods?country=${country}`);
};

// 6. Crear Orden de Pago (Redirect)
export const createPaymentOrder = async (data) => {
  return await sendRequest('POST', '/orders', data);
};

// 7. Crear Orden de Pago Directa
export const createDirectPaymentOrder = async (data) => {
  return await sendRequest('POST', '/orders/direct', data);
};