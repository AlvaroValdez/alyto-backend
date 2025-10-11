// backend/src/services/vitaService.js
// Fuente Vita: GET /api/businesses/prices, GET /api/businesses/withdrawal_rules, POST /api/businesses/transactions
// Justificación: centralizamos todo en precios y reglas; payment_methods/:country ya no existe.

//const { client, bubbleAxiosError } = require('./vitaClient');
const { client } = require('./vitaClient');

// --- LÓGICA DE CACHÉ PARA PRECIOS ---
let cachedPrices = null;
let cacheTimestamp = null;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutos

const getListPrices = async () => {
  if (cachedPrices && (Date.now() - cacheTimestamp < CACHE_DURATION_MS)) {
    console.log('⚡️ [vitaService] Devolviendo precios desde la caché.');
    return cachedPrices;
  }
  console.log('⏳ [vitaService] Obteniendo nuevos precios desde Vita Wallet...');
  const { data } = await client.get('/api/businesses/prices');
  cachedPrices = data; // Correcto: se guarda el objeto data directamente
  cacheTimestamp = Date.now();
  return cachedPrices;
};

// --- FUNCIÓN CORREGIDA ---
const getWithdrawalRules = async () => {
  console.log('ℹ️ [vitaService] Obteniendo withdrawal rules desde Vita Wallet...');
  const { data } = await client.get('/api/businesses/withdrawal_rules');
  // CORRECCIÓN: Devolvemos 'data' directamente, no 'data.data'
  return data;
};

const createWithdrawal = async (payload) => {
  const { data } = await client.post('/api/businesses/transactions', payload);
  return data;
};

module.exports = {
  getListPrices,
  getWithdrawalRules,
  createWithdrawal,
};


