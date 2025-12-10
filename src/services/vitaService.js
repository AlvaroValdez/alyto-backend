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

// ==========================================
// FUNCIONES EXPORTADAS (Compatibilidad Total)
// ==========================================

// 1. PRECIOS
// Usado por routes/prices.js (busca getListPrices)
export const getListPrices = async () => {
  return await sendRequest('GET', '/prices');
};
// Alias por si algo busca getPrices
export const getPrices = getListPrices;


// 2. REGLAS DE RETIRO
// Usado por withdrawalValidator.js (busca getWithdrawalRules)
export const getWithdrawalRules = async (country) => {
  const endpoint = country ? `/withdrawals/rules/${country}` : '/withdrawals/rules';
  return await sendRequest('GET', endpoint);
};


// 3. COTIZACIÓN
// Usado por calculadora
export const getQuote = async (data) => {
  return await sendRequest('POST', '/exchange/calculation', data);
};


// 4. RETIROS (Payouts)
// Usado por routes/withdrawals.js
export const createWithdrawal = async (data) => {
  return await sendRequest('POST', '/withdrawals', data);
};


// 5. MÉTODOS DE PAGO (Pay-ins)
// Usado por routes/paymentOrders.js
export const getPaymentMethods = async (country = 'CL') => {
  return await sendRequest('GET', `/payment_methods?country=${country}`);
};


// 6. ÓRDENES DE PAGO (Redirect)
// Usado por routes/paymentOrders.js
export const createPaymentOrder = async (data) => {
  return await sendRequest('POST', '/orders', data);
};


// 7. PAGO DIRECTO (Marca Blanca)
// ESTA ES LA QUE FALLABA: routes/paymentOrders.js busca 'executeDirectPayment'
export const executeDirectPayment = async (data) => {
  return await sendRequest('POST', '/orders/direct', data);
};
// Alias moderno
export const createDirectPaymentOrder = executeDirectPayment;