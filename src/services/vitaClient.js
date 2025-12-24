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

// sorted_request_body:
// keys top-level ordenadas + concat key+value (sin separadores)
// objects/arrays: JSON.stringify(value)
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

// vita.baseURL debe apuntar al Base URL de Business API:
// stage: https://api.stage.vitawallet.io/api/businesses
// prod:  https://api.vitawallet.io/api/businesses
const client = axios.create({
  baseURL: vita.baseURL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
});

client.interceptors.request.use((config) => {
  const xLogin = String(vita.login || '').replace(/\s+/g, '');
  const xApiKey = String(vita.transKey || '').replace(/\s+/g, '');
  const secretKey = String(vita.secret || '').replace(/\s+/g, '');

  if (!xLogin || !xApiKey || !secretKey) {
    throw new Error('Missing Vita credentials (VITA_LOGIN / VITA_TRANS_KEY / VITA_SECRET)');
  }

  const xDate = new Date().toISOString();
  const url = String(config.url || '').toLowerCase();

  const isBusinessUsers = url.includes('/business_users');
  const isDirectPayment = url.includes('/direct_payment');
  const isPaymentMethods = url.includes('/payment_methods/');
  const isDirectPayFamily = isDirectPayment || isPaymentMethods;

  let bodyObj = undefined;
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

    // ✅ NO canonicalizar profundo
    bodyObj = deepClean(raw) || {};
    bodyString = JSON.stringify(bodyObj);

    config.data = bodyString;
    config.transformRequest = [(data) => data];
  }

  const hasBody = Boolean(bodyString && bodyString !== '{}' && bodyString !== '');

  config.headers = config.headers || {};

  // ====================================================================
  // AUTENTICACIÓN SEGÚN DOCUMENTACIÓN OFICIAL
  // ====================================================================

  //  POST /direct_payment: DirectPayment usa JSON RAW, no sorted key-value
  if (isDirectPayment) {
    console.log('[vitaClient] 💳 POST /direct_payment - DirectPay Auth (JSON raw)');

    // ⚠️ DIFERENCIA CLAVE: DirectPayment usa bodyString (JSON raw), NO buildSortedRequestBody
    const signatureBody = hasBody ? bodyString : '';

    const signatureBase = `${xLogin}${xDate}${signatureBody}`;
    const signature = hmacSha256Hex(secretKey, signatureBase);

    config.headers['x-date'] = xDate;
    config.headers['x-login'] = xLogin;
    config.headers['x-trans-key'] = xApiKey;
    if (isDirectPayFamily) {
      // Exacto según DirectPayment.txt:
      // "V2-HMAC-SHA256, Signature:{signature}"
      config.headers['Authorization'] = `V2-HMAC-SHA256, Signature:${signature}`;
    } else {
      // Mantén lo anterior para no tocar lo que ya funciona
      config.headers['Authorization'] = `V2-HMAC-SHA256, Signature: ${signature}`;
    }


    console.log('[vitaClient]   signatureBody (first 200):', signatureBody.substring(0, 200));
    console.log('[vitaClient]   signatureBase (first 200):', signatureBase.substring(0, 200));
    console.log('[vitaClient]   signature:', signature);

    return config;
  }

  // 🔐 Resto de endpoints: Autenticación estándar (funcionando actualmente)
  const signatureBody = hasBody
    ? (isBusinessUsers ? bodyString : buildSortedRequestBody(bodyObj))
    : '';

  const signatureBase = `${xLogin}${xDate}${signatureBody}`;
  const signature = hmacSha256Hex(secretKey, signatureBase);

  config.headers = config.headers || {};
  config.headers['x-date'] = xDate;
  config.headers['x-login'] = xLogin;

  // Para DirectPay/payment_methods: SOLO x-trans-key (como el doc)
  if (isDirectPayFamily) {
    config.headers['x-trans-key'] = xApiKey;     // (xApiKey aquí es tu vita.transKey)
    delete config.headers['x-api-key'];          // importantísimo: no enviar x-api-key
  } else {
    // Mantén tu comportamiento anterior para no romper nada existente
    config.headers['x-api-key'] = xApiKey;
    config.headers['x-trans-key'] = xApiKey;
  }

  // DEBUG: Mostrar todos los headers
  console.log('[vitaClient] 🔑 AUTHORIZATION DEBUG:');
  console.log('[vitaClient] x-date:', xDate);
  console.log('[vitaClient] x-login:', xLogin);
  console.log('[vitaClient] x-api-key:', xApiKey.substring(0, 10) + '...');
  console.log('[vitaClient] Authorization:', config.headers['Authorization'].substring(0, 60) + '...');
  console.log('[vitaClient] Signature base:', `${xLogin}${xDate}${signatureBody}`.substring(0, 100));
  console.log('[vitaClient] Signature (full):', signature);


  if (process.env.VITA_DEBUG_SIGNATURE === 'true') {
    console.log(`[vitaClient] ${String(config.method || 'GET').toUpperCase()} ${config.url}`);
    console.log(`[vitaClient] mode=${isBusinessUsers ? 'RAW_JSON business_users' : 'SORTED_KV'} hasBody=${hasBody}`);
    console.log(`[vitaClient] bodyLen=${bodyString.length} sigBodyLen=${signatureBody.length}`);

    const sorted = hasBody ? buildSortedRequestBody(bodyObj) : '';
    console.log(`[vitaClient] sorted_request_body(0..300): ${sorted.slice(0, 300)}`);
    console.log(`[vitaClient] bodyString(0..300): ${bodyString.slice(0, 300)}`);

    try {
      const parsed = bodyString ? JSON.parse(bodyString) : {};
      console.log('[vitaClient] types:', {
        amount: typeof parsed.amount,
        bank_code: typeof parsed.bank_code,
        currency: typeof parsed.currency,
      });
    } catch { }

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