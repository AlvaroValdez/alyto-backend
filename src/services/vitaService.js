import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// --- HELPER DE AUTENTICACIÓN ---
const getAuthHeaders = (method, urlPath, bodyString = '') => {
  if (!vita.apiSecret) throw new Error("CONFIG ERROR: Falta VITA_SECRET_KEY.");

  const date = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', vita.apiSecret).update(bodyString).digest('hex');

  return {
    'Content-Type': 'application/json',
    'x-login': vita.apiLogin,
    'x-trans-key': signature,
    'x-date': date,
  };
};

// --- HELPER GENÉRICO ---
const sendRequest = async (method, endpoint, data = null) => {
  const url = `${vita.apiUrl}${endpoint}`;
  const bodyString = data ? JSON.stringify(data) : ''; // Firma exacta
  const headers = getAuthHeaders(method, endpoint, bodyString);

  try {
    const config = { headers };
    if (method === 'GET') return (await axios.get(url, config)).data;
    if (method === 'POST') return (await axios.post(url, bodyString, config)).data;
  } catch (error) {
    console.error(`[VitaService] Error en ${endpoint}:`, error.response?.data || error.message);
    throw error;
  }
};

// ==========================================
// FUNCIONES EXPORTADAS (Compatibilidad Total)
// ==========================================

// 1. PRECIOS (Usado por tu prices.js original)
export const getListPrices = async () => {
  return await sendRequest('GET', '/prices');
};

// 2. REGLAS DE RETIRO (Usado por withdrawalValidator.js)
export const getWithdrawalRules = async (country) => {
  const endpoint = country ? `/withdrawals/rules/${country}` : '/withdrawals/rules';
  return await sendRequest('GET', endpoint);
};

// 3. COTIZACIÓN
export const getQuote = async (data) => {
  return await sendRequest('POST', '/exchange/calculation', data);
};

// 4. RETIROS (Payouts)
export const createWithdrawal = async (data) => {
  return await sendRequest('POST', '/withdrawals', data);
};

// 5. MÉTODOS DE PAGO (Pay-ins)
export const getPaymentMethods = async (country = 'CL') => {
  return await sendRequest('GET', `/payment_methods?country=${country}`);
};

// 6. ÓRDENES DE PAGO (Redirect)
export const createPaymentOrder = async (data) => {
  return await sendRequest('POST', '/orders', data);
};

// 7. PAGO DIRECTO (Marca Blanca)
// Esta función faltaba y causaba el crash en paymentOrders.js
export const executeDirectPayment = async (data) => {
  return await sendRequest('POST', '/orders/direct', data);
};
// Alias para compatibilidad futura
export const createDirectPaymentOrder = executeDirectPayment;