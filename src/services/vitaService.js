// backend/src/services/vitaService.js
// Fuente Vita: GET /api/businesses/prices, GET /api/businesses/withdrawal_rules, POST /api/businesses/transactions
// Justificación: centralizamos todo en precios y reglas; payment_methods/:country ya no existe.

const { client, bubbleAxiosError } = require('./vitaClient');

// ✅ Precios (con min_amount y payment_methods)
async function getListPrices() {
  try {
    const { data } = await client.get('/api/businesses/prices');
    return data;
  } catch (err) { bubbleAxiosError(err); }
}

// ✅ Reglas dinámicas de retiro
async function getWithdrawalRules() {
  try {
    const { data } = await client.get('/api/businesses/withdrawal_rules');
    return data;
  } catch (err) { bubbleAxiosError(err); }
}

// ✅ Crear retiro (withdrawal)
async function createWithdrawal(payload) {
  try {
    const { data } = await client.post('/api/businesses/transactions', payload);
    return data;
  } catch (err) { bubbleAxiosError(err); }
}

module.exports = {
  getListPrices,
  getWithdrawalRules,
  createWithdrawal,
};


