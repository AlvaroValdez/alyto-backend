import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// --- CONFIGURACIÓN DE PAÍSES SOPORTADOS ---
// Definimos los corredores aquí en el servicio, no en la ruta.
const SUPPORTED_CORRIDORS = [
  { code: 'CL', name: 'Chile', currency: 'CLP', flag: '🇨🇱' },
  { code: 'CO', name: 'Colombia', currency: 'COP', flag: '🇨🇴' },
  { code: 'PE', name: 'Perú', currency: 'PEN', flag: '🇵🇪' },
  { code: 'AR', name: 'Argentina', currency: 'ARS', flag: '🇦🇷' },
  { code: 'BR', name: 'Brasil', currency: 'BRL', flag: '🇧🇷' },
  { code: 'MX', name: 'México', currency: 'MXN', flag: '🇲🇽' },
  { code: 'US', name: 'Estados Unidos', currency: 'USD', flag: '🇺🇸' },
  { code: 'VE', name: 'Venezuela', currency: 'VES', flag: '🇻🇪' },
  { code: 'BO', name: 'Bolivia', currency: 'BOB', flag: '🇧🇴', manual: true }
];

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
  const bodyString = data ? JSON.stringify(data) : '';
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
// FUNCIONES EXPORTADAS
// ==========================================

// 1. PRECIOS (Transformados para el Frontend)
export const getListPrices = async () => {
  try {
    // A. Pedimos las tasas reales a Vita (para asegurar conexión y datos frescos)
    // Usamos /prices o /exchange/rates según disponibilidad
    const rates = await sendRequest('GET', '/prices');

    // B. Mezclamos la configuración de países con las tasas recibidas (Opcional)
    // Si Vita devuelve { cop: 4000 }, podríamos inyectarlo aquí.
    // Por ahora, devolvemos la lista de países que es lo que el Frontend exige.
    return SUPPORTED_CORRIDORS.map(country => ({
      ...country,
      // Si la respuesta de Vita trae la tasa, la agregamos (ej: rates['cop'])
      rate: rates && rates[country.currency.toLowerCase()]
    }));

  } catch (error) {
    console.warn("⚠️ Error obteniendo tasas de Vita, devolviendo lista base:", error.message);
    // Fallback: Si Vita falla, al menos mostramos los países para que la UI cargue
    return SUPPORTED_CORRIDORS;
  }
};

// 2. REGLAS DE RETIRO
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
export const executeDirectPayment = async (data) => {
  return await sendRequest('POST', '/orders/direct', data);
};
export const createDirectPaymentOrder = executeDirectPayment;