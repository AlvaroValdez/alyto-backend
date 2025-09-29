// backend/src/services/vitaClient.js
const crypto = require('crypto');
const axios = require('axios');
const { vita, isProd } = require('../config/env');

function buildAuthSignature(xLogin, xDate, body) {
  let sortedBody = '';
  if (body && Object.keys(body).length > 0) {
    const sorted = Object.keys(body).sort().map(k => `${k}${body[k]}`).join('');
    sortedBody = sorted;
  }
  const raw = `${xLogin}${xDate}${sortedBody}`;
  const signature = crypto.createHmac('sha256', vita.secret).update(raw).digest('hex');

  // 🟠 Log temporal de debug
  if (!isProd) {
    console.log('[vitaClient] Signing payload:', raw);
    console.log('[vitaClient] Generated signature:', signature);
  }

  return signature;
}

const client = axios.create({
  baseURL: vita.baseURL,
  timeout: 15000,
});

client.interceptors.request.use((config) => {
  const xDate = new Date().toISOString();
  config.headers['X-Date'] = xDate;
  config.headers['X-Login'] = vita.login;
  config.headers['X-Trans-Key'] = vita.transKey;
  config.headers['Content-Type'] = 'application/json';

  let bodyForSig = null;
  if (config.data && typeof config.data === 'object') {
    bodyForSig = config.data;
  }
  const signature = buildAuthSignature(vita.login, xDate, bodyForSig);
  config.headers['Authorization'] = `V2-HMAC-SHA256, Signature: ${signature}`;

  // 🟠 Log de request saliente
  if (!isProd) {
    console.log(`[vitaClient] ${config.method?.toUpperCase()} ${config.url}`);
    console.log('[vitaClient] Headers enviados:', {
      'X-Date': xDate,
      'X-Login': vita.login,
      'X-Trans-Key': vita.transKey,
      Authorization: config.headers['Authorization'],
    });
  }

  return config;
});

function bubbleAxiosError(err) {
  if (err.response) {
    const { status, data } = err.response;
    const message = typeof data === 'string' ? data : (data?.message || JSON.stringify(data));
    const e = new Error(`Vita API error: HTTP ${status} - ${message}`);
    e.status = status;
    e.data = data;
    throw e;
  }
  throw new Error(`Vita API network error: ${err.message}`);
}

module.exports = { client, bubbleAxiosError };
