// backend/src/services/vitaClient.js
import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

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
  return JSON.stringify(value);
}

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

const client = axios.create({
  baseURL: vita.baseURL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  try {
    // ------------------------------------------------------------
    // Credenciales
    // ------------------------------------------------------------
    const xLogin = String(vita.login || '').replace(/\s+/g, '');
    const xTransKey = String(vita.transKey || '').replace(/\s+/g, '');
    const secretKey = String(vita.secret || '').replace(/\s+/g, '');

    if (!xLogin || !xTransKey || !secretKey) {
      throw new Error('Missing Vita credentials (VITA_LOGIN / VITA_TRANS_KEY / VITA_SECRET)');
    }

    // ------------------------------------------------------------
    // Request meta (SIEMPRE definido)
    // ------------------------------------------------------------
    const xDate = new Date().toISOString();
    const urlRaw = String(config.url || '');
    const url = urlRaw.toLowerCase(); // canon para detección
    const method = String(config.method || 'GET').toUpperCase();

    // ✅ Flags SIEMPRE definidos (evita "isPaymentMethods is not defined")
    const isPaymentMethods = url.startsWith('/payment_methods/');
    const isDirectPayment = url.includes('/direct_payment');
    const isBusinessUsers = url.includes('/business_users');

    // ------------------------------------------------------------
    // Body (si aplica)
    // ------------------------------------------------------------
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

      config.data = bodyString;
      config.transformRequest = [(data) => data];
    }

    const hasBody = Boolean(bodyString && bodyString !== '{}' && bodyString !== '');

    // ------------------------------------------------------------
    // Headers base
    // ------------------------------------------------------------
    config.headers = config.headers || {};
    config.headers['x-date'] = xDate;
    config.headers['x-login'] = xLogin;

    // ------------------------------------------------------------
    // 1) payment_methods: Firma incluyendo el parámetro de URL
    // ------------------------------------------------------------
    if (isPaymentMethods) {
      // Extraemos el código de país (ej: /payment_methods/cl -> "cl")
      const countryCode = urlRaw.split('/').pop().toLowerCase();

      /**
       * REGLA VITA: Parámetros ordenados alfabéticamente y concatenados.
       * Para este GET, el parámetro es 'country_iso_code'.
       * Resultado esperado: "country_iso_codecl"
       */
      const signatureParam = `country_iso_code${countryCode}`;

      // ✅ La base debe ser: Login + Fecha + Parámetros [cite: 1]
      const signatureBase = `${xLogin}${xDate}${signatureParam}`;
      const signature = hmacSha256Hex(secretKey, signatureBase);

      config.headers['x-date'] = xDate;
      config.headers['x-login'] = xLogin;

      // Requerido explícitamente por el módulo Direct Payment 
      config.headers['x-trans-key'] = xTransKey;
      config.headers['x-api-key'] = xTransKey;

      // ✅ Formato estricto: Espacio tras la coma y tras los dos puntos 
      config.headers['Authorization'] = `V2-HMAC-SHA256, Signature: ${signature}`;

      if (process.env.VITA_DEBUG_SIGNATURE === 'true') {
        console.log('[vitaClient] 🔑 payment_methods FIXED (With Params)');
        console.log('[vitaClient] signatureBase:', signatureBase);
        console.log('[vitaClient] signature:', signature);
      }

      return config;
    }

    // ------------------------------------------------------------
    // 2) direct_payment: (firma RAW JSON con bodyString)
    // ------------------------------------------------------------
    if (isDirectPayment) {
      // ⚠️ CRÍTICO: DirectPayment usa bodyString (JSON raw), NO buildSortedRequestBody
      const signatureBody = hasBody ? bodyString : '';
      const signatureBase = `${xLogin}${xDate}${signatureBody}`;

      const signature = hmacSha256Hex(secretKey, signatureBase);

      config.headers['x-api-key'] = xTransKey;
      config.headers['x-trans-key'] = xTransKey;
      config.headers['Authorization'] = `V2-HMAC-SHA256, Signature: ${signature}`;

      if (process.env.VITA_DEBUG_SIGNATURE === 'true') {
        console.log('[vitaClient] 💳 POST /direct_payment - JSON RAW');
        console.log('[vitaClient] signatureBody (first 200):', signatureBody.substring(0, 200));
        console.log('[vitaClient] signatureBase (first 200):', signatureBase.substring(0, 200));
        console.log('[vitaClient] signature:', signature);
      }

      return config;
    }

    // ------------------------------------------------------------
    // 3) Resto: estándar actual (business_users RAW, otros SORTED_KV)
    // ------------------------------------------------------------
    const signatureBody = hasBody
      ? (isBusinessUsers ? bodyString : buildSortedRequestBody(bodyObj))
      : '';

    const signatureBase = `${xLogin}${xDate}${signatureBody}`;
    const signature = hmacSha256Hex(secretKey, signatureBase);

    // Mantén lo que te funcionaba en el resto
    config.headers['x-api-key'] = xTransKey;
    config.headers['x-trans-key'] = xTransKey;
    config.headers['Authorization'] = `V2-HMAC-SHA256, Signature: ${signature}`;

    if (process.env.VITA_DEBUG_SIGNATURE === 'true') {
      console.log('[vitaClient] 🔑 standard AUTH');
      console.log('[vitaClient] ', method, urlRaw);
      console.log('[vitaClient] mode=', isBusinessUsers ? 'RAW_JSON business_users' : 'SORTED_KV', 'hasBody=', hasBody);
      console.log('[vitaClient] signatureBase(0..200):', signatureBase.slice(0, 200));
      console.log('[vitaClient] signature(full):', signature);
    }

    return config;
  } catch (e) {
    console.error('[vitaClient] ❌ Interceptor crash:', e?.stack || e);
    throw e;
  }
});

client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error?.response?.status;
    const data = error?.response?.data;
    const url = String(error?.config?.url || '');
    const code = data?.error?.code;

    // ✅ Auto-retry SOLO para payment_methods cuando es 303
    const isPaymentMethods = url.toLowerCase().startsWith('/payment_methods/');
    const attempt = Number(error?.config?._vita_pm_attempt || 0);

    if (isPaymentMethods && status === 422 && code === 303 && attempt < 5) {
      const newConfig = { ...error.config, _vita_pm_attempt: attempt + 1 };
      // Evita loops raros
      delete newConfig.headers?.Authorization;

      if (process.env.VITA_DEBUG_SIGNATURE === 'true') {
        console.log(`[vitaClient] 🔁 Retrying payment_methods (303) attempt=${attempt + 1}`);
      }

      return client.request(newConfig);
    }

    console.error(`❌ [vitaClient] Error ${status || 'NO_STATUS'} on ${url || 'NO_URL'}`);
    console.error('>> Vita Response:', JSON.stringify(data));
    return Promise.reject(error);
  }
);

export { client };
