import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// --- 1. CONFIGURACIÓN DE CORREDORES (BUSINESS LOGIC) ---
// Según documentación, Vita soporta estos ISO codes. 
// Definimos esta lista aquí para enriquecerla con datos de UI (Banderas/Nombres) 
// que la API de Vita NO entrega.
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

// --- 2. HELPERS DE SEGURIDAD ---
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

// 1. OBTENER LISTA DE PRECIOS (Transformada)
export const getListPrices = async () => {
  try {
    // Paso A: Consultamos las tasas a Vita (GET /prices según doc)
    // Esto sirve para asegurar que la API responde y obtener tasas frescas
    const apiRates = await sendRequest('GET', '/prices');

    // Paso B: Mapeamos nuestra lista de países y le agregamos la tasa si existe
    // Esto transforma el Objeto de Vita en el Array que tu Frontend necesita.
    const countriesList = SUPPORTED_CORRIDORS.map(country => {
      // Buscamos la tasa correspondiente (ej: usd, btc, o moneda local si viniera)
      // Vita suele devolver tasas base, aquí solo aseguramos devolver la estructura correcta
      return {
        ...country,
        // Si quisieras adjuntar la tasa real devuelta por Vita:
        // rate: apiRates[country.currency.toLowerCase()] || 0
      };
    });

    return countriesList;

  } catch (error) {
    console.warn("⚠️ Error conectando con Vita (Precios). Usando lista offline.");
    // Fallback: Si Vita cae (500/404), la web NO DEBE mostrarse vacía.
    // Devolvemos la lista de países para que el usuario pueda seguir operando.
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