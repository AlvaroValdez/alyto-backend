import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// --- VARIABLES DE CACHÉ (Restauradas de tu código original) ---
let cachedPrices = null;
let cacheTimestamp = null;
const CACHE_DURATION_MS = 15 * 1000; // 15 segundos
let pricesPromise = null;

// --- HELPER DE AUTENTICACIÓN (BLINDADO) ---
// Mantenemos esto para evitar el error 303 "Invalid Signature" en los POST
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

// --- HELPER DE PETICIÓN ---
// Reemplaza al 'client' de vitaClient.js para garantizar firmas correctas
const sendRequest = async (method, endpoint, data = null) => {
  const url = `${vita.apiUrl}${endpoint}`;
  // Stringify manual crítico para la firma
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
    return response.data; // Axios devuelve { data: ... }, aquí retornamos el body de la respuesta
  } catch (error) {
    console.error(`[VitaService] Error en ${endpoint}:`, error.response?.data || error.message);
    throw error;
  }
};

// ==========================================
// FUNCIONES DEL SERVICIO (Endpoints Originales Restaurados)
// ==========================================

// 1. OBTENER LISTA DE PRECIOS (Con Caché y Endpoint Original)
export const getListPrices = async () => {
  // Lógica de caché original
  if (cachedPrices && (Date.now() - cacheTimestamp < CACHE_DURATION_MS)) {
    console.log('⚡️ [vitaService] Devolviendo precios desde la caché.');
    return cachedPrices;
  }

  if (pricesPromise) return pricesPromise;

  console.log('⏳ [vitaService] Obteniendo nuevos precios desde Vita Wallet (/api/businesses/prices)...');

  // Usamos el endpoint original que SÍ devuelve la lista de países
  pricesPromise = sendRequest('GET', '/api/businesses/prices')
    .then((data) => {
      // Nota: sendRequest ya devuelve data, pero si la API devuelve { data: [...] } o [...] directo
      // nos aseguramos de guardar lo correcto.
      cachedPrices = data.data || data; // Ajuste por si viene anidado
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
export const getWithdrawalRules = async (country) => {
  // Endpoint original
  return await sendRequest('GET', '/api/businesses/withdrawal_rules');
};

// 3. CREAR RETIRO (Payouts)
export const createWithdrawal = async (payload) => {
  // Endpoint original: /api/businesses/transactions
  // Este fue el que arreglamos hoy para el error 303, lo mantenemos con sendRequest
  return await sendRequest('POST', '/api/businesses/transactions', payload);
};

// 4. MÉTODOS DE PAGO (Pay-ins)
export const getPaymentMethods = async (country) => {
  console.log(`ℹ️ [vitaService] Obteniendo métodos de pago para: ${country}`);
  // Endpoint original
  return await sendRequest('GET', `/api/businesses/payment_methods/${country}`);
};

// 5. CREAR ORDEN DE PAGO (Redirect)
export const createPaymentOrder = async (payload) => {
  // Endpoint original
  return await sendRequest('POST', '/api/businesses/payment_orders', payload);
};

// 6. EJECUTAR PAGO DIRECTO
// Adaptamos para recibir el objeto único que envía el controller, pero usamos el endpoint original
export const executeDirectPayment = async (data) => {
  // data viene como { uid: 'order-id', ...datos_pago } desde el controller
  const { uid, ...paymentData } = data;

  // Reconstruimos el payload como lo esperaba tu código original: { payment_data: ... }
  const payload = { payment_data: paymentData };

  // Endpoint original: /api/businesses/payment_orders/{ID}/direct_payment
  return await sendRequest('POST', `/api/businesses/payment_orders/${uid}/direct_payment`, payload);
};

// Alias de compatibilidad
export const createDirectPaymentOrder = executeDirectPayment;
// Alias para cotización (si usas la calculadora)
export const getQuote = async (data) => {
  // Si tenías un endpoint específico para cotizar en businesses, úsalo aquí.
  // Si no, usamos el de cálculo estándar.
  return await sendRequest('POST', '/exchange/calculation', data);
};