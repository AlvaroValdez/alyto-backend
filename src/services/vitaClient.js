// backend/src/services/vitaClient.js
import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// Elimina undefined/null recursivamente
function deepClean(value) {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map(deepClean).filter(v => v !== undefined);

  if (value && typeof value === 'object' && value.constructor === Object) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = deepClean(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return value;
}

// Stringify estable (keys ordenadas recursivamente) para valores objeto,
// solo cuando estemos en SORTED_KV y haya objects/arrays como value.
function stableStringify(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object' && value.constructor === Object) {
    const keys = Object.keys(value).sort();
    const props = keys.map(k => `"${k}":${stableStringify(value[k])}`);
    return `{${props.join(',')}}`;
  }
  return JSON.stringify(value); // strings/numbers/bools
}

// sorted_request_body: keys top-level ordenadas + concat key+value (sin separadores)
function buildSortedRequestBody(bodyObj) {
  if (!bodyObj || typeof bodyObj !== 'object') return '';

  const keys = Object.keys(bodyObj).sort();
  let out = '';

  for (const k of keys) {
    const v = bodyObj[k];
    if (v === undefined || v === null) continue;

    if (typeof v === 'object') out += `${k}${stableStringify(v)}`;
    else out += `${k}${String(v)}`;
  }
  return out;
}

function hmacSha256Hex(secret, msg) {
  return crypto.createHmac('sha256', secret).update(msg, 'utf8').digest('hex');
}

// stage: https://api.stage.vitawallet.io/api/businesses
// prod:  https://api.vitawallet.io/api/businesses
const client = axios.create({
  baseURL: vita.baseURL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  const xLogin = String(vita.login || '').replace(/\s+/g, '');
  const xTransKey = String(vita.transKey || '').replace(/\s+/g, '');
  const secretKey = String(vita.secret || '').replace(/\s+/g, '');

  if (!xLogin || !xTransKey || !secretKey) {
    throw new Error('Missing Vita credentials (VITA_LOGIN / VITA_TRANS_KEY / VITA_SECRET)');
  }

  const xDate = new Date().toISOString();
  const url = String(config.url || '').toLowerCase();
  const method = String(config.method || 'GET').toUpperCase(); // ✅ FIX: define method

  // Familias / modos
  const isBusinessUsers = url.includes('/business_users');
  const isDirectPayment = url.includes('/direct_payment');
  const isPaymentMethods = url.includes('/payment_methods/');
  const isDirectPayFamily = isDirectPayment || isPaymentMethods;

  // Detecta body
  let bodyObj;
  let bodyString = '';

  const hasRequestBody =
    method !== 'GET' &&
    config.data !== undefined &&
    config.data !== null &&
    config.data !== '';

  if (hasRequestBody) {
    let raw = config.data;

    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { raw = {}; }
    }
    if (!raw || typeof raw !== 'object') raw = {};

    bodyObj = deepClean(raw) || {};
    bodyString = JSON.stringify(bodyObj);

    // aseguramos que lo firmado sea exactamente lo enviado
    config.data = bodyString;
    config.transformRequest = [(data) => data];
  }

  const hasBody = Boolean(bodyString && bodyString !== '{}' && bodyString !== '');

  config.headers = config.headers || {};

  // =========================================================
  // AUTENTICACIÓN (sin cambiar el algoritmo)
  // =========================================================

  // 1) DirectPay family (DirectPayment.txt):
  // headers requeridos: x-login, x-trans-key, x-date, Authorization
  // Authorization exacto: "V2-HMAC-SHA256, Signature:{signature}"
  // DirectPayment usa JSON RAW (bodyString) cuando hay body.
  if (isDirectPayFamily) {
    const signatureBody = hasBody ? bodyString : '';
    const signatureBase = `${xLogin}${xDate}${signatureBody}`;
    const signature = hmacSha256Hex(secretKey, signatureBase);

    config.headers['x-date'] = xDate;
    config.headers['x-login'] = xLogin;
    config.headers['x-trans-key'] = xTransKey;

    // IMPORTANTÍSIMO: no enviar x-api-key en esta familia
    delete config.headers['x-api-key'];

    // Formato exacto (sin espacio extra)
    config.headers['Authorization'] = `V2-HMAC-SHA256, Signature:${signature}`;

    if (process.env.VITA_DEBUG_SIGNATURE === 'true') {
      console.log('[vitaClient] 🔑 DirectPayFamily AUTH');
      console.log('[vitaClient] ', method, config.url);
      console.log('[vitaClient] x-date:', xDate);
      console.log('[vitaClient] x-login:', xLogin);
      console.log('[vitaClient] x-trans-key:', xTransKey.substring(0, 10) + '...');
      console.log('[vitaClient] hasBody:', hasBody, 'bodyLen:', bodyString.length);
      console.log('[vitaClient] signatureBase(0..200):', signatureBase.slice(0, 200));
      console.log('[vitaClient] signature(full):', signature);
    }

    return config;
  }

  // 2) Resto de endpoints (comportamiento actual):
  // - business_users: RAW JSON
  // - otros: SORTED_KV
  const signatureBody = hasBody
    ? (isBusinessUsers ? bodyString : buildSortedRequestBody(bodyObj))
    : '';

  const signatureBase = `${xLogin}${xDate}${signatureBody}`;
  const signature = hmacSha256Hex(secretKey, signatureBase);

  config.headers['x-date'] = xDate;
  config.headers['x-login'] = xLogin;

  // Mantén lo que te venía funcionando: x-api-key + x-trans-key
  config.headers['x-api-key'] = xTransKey;
  config.headers['x-trans-key'] = xTransKey;

  // Asegura Authorization también aquí (se te había perdido)
  config.headers['Authorization'] = `V2-HMAC-SHA256, Signature: ${signature}`;

  // Debug seguro (no crashea si faltara algo)
  if (process.env.VITA_DEBUG_SIGNATURE === 'true') {
    console.log('[vitaClient] 🔑 STANDARD AUTH');
    console.log('[vitaClient] ', method, config.url);
    console.log('[vitaClient] x-date:', xDate);
    console.log('[vitaClient] x-login:', xLogin);
    console.log('[vitaClient] x-api-key:', xTransKey.substring(0, 10) + '...');
    console.log('[vitaClient] Authorization:', String(config.headers['Authorization']).slice(0, 80) + '...');
    console.log('[vitaClient] mode=', isBusinessUsers ? 'RAW_JSON business_users' : 'SORTED_KV', 'hasBody=', hasBody);
    console.log('[vitaClient] signatureBase(0..200):', signatureBase.slice(0, 200));
    console.log('[vitaClient] signature(full):', signature);

    if (hasBody) {
      const sorted = isBusinessUsers ? '(raw json mode)' : buildSortedRequestBody(bodyObj);
      console.log('[vitaClient] sorted_request_body(0..300):', String(sorted).slice(0, 300));
      console.log('[vitaClient] bodyString(0..300):', String(bodyString).slice(0, 300));
    }
  }

  return config;
});

client.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status;
    const data = error?.response?.data;
    const url = error?.config?.url;

    console.error(`❌ [vitaClient] Error ${status || 'NO_STATUS'} on ${url || 'NO_URL'}`);
    console.error('>> Vita Response:', JSON.stringify(data));
    return Promise.reject(error);
  }
);

export { client };
