// backend/src/services/vitaClient.js
import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// ==========================================
// Helpers de Limpieza y Serialización
// ==========================================

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

/**
 * REGLA VITA: Concatenación recursiva sin separadores (llavevalorllavevalor)
 * Usada para Direct Payment y el estándar.
 */
function buildSortedRequestBody(bodyObj) {
  if (!bodyObj || typeof bodyObj !== 'object') return '';

  const keys = Object.keys(bodyObj).sort();
  let out = '';

  for (const k of keys) {
    const v = bodyObj[k];
    if (v === undefined || v === null) continue;

    if (typeof v === 'object' && !Array.isArray(v)) {
      // Recursividad para objetos anidados (ej: payment_data)
      out += `${k}${buildSortedRequestBody(v)}`;
    } else {
      out += `${k}${String(v)}`;
    }
  }
  return out;
}

function hmacSha256Hex(secret, msg) {
  return crypto.createHmac('sha256', secret).update(msg, 'utf8').digest('hex');
}

// ==========================================
// Configuración del Cliente
// ==========================================

const client = axios.create({
  baseURL: vita.baseURL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  try {
    // 1. Credenciales
    const xLogin = String(vita.login || '').replace(/\s+/g, '');
    const xTransKey = String(vita.transKey || '').replace(/\s+/g, '');
    const secretKey = String(vita.secret || '').replace(/\s+/g, '');

    if (!xLogin || !xTransKey || !secretKey) {
      throw new Error('Missing Vita credentials (VITA_LOGIN / VITA_TRANS_KEY / VITA_SECRET)');
    }

    // 2. Metadatos de la petición
    const urlRaw = String(config.url || '');
    const url = urlRaw.toLowerCase();
    const method = String(config.method || 'GET').toUpperCase();

    // ✅ FIX: Fecha sin milisegundos para evitar errores 303 por discrepancia de tiempo 
    const xDate = new Date().toISOString().split('.')[0] + 'Z';

    // 3. Flags de Detección
    const isPaymentMethods = url.includes('/payment_methods/');
    const isDirectPayment = url.includes('/direct_payment');
    const isPaymentAttempt = url.includes('/attempts/');
    const isBusinessUsers = url.includes('/business_users');

    // 4. Procesamiento del Body
    let bodyObj;
    let bodyString = '';
    const hasRequestBody = method !== 'GET' && config.data;

    if (hasRequestBody) {
      let raw = config.data;
      if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch { raw = {}; }
      }
      bodyObj = deepClean(raw) || {};
      bodyString = JSON.stringify(bodyObj);

      config.data = bodyString;
      config.transformRequest = [(data) => data];
    }
    const hasBody = Boolean(bodyString && bodyString !== '{}');

    // 5. Configuración de Headers Base
    config.headers = config.headers || {};
    config.headers['x-date'] = xDate;
    config.headers['x-login'] = xLogin;
    config.headers['x-trans-key'] = xTransKey;
    config.headers['x-api-key'] = xTransKey;

    // ------------------------------------------------------------
    // LÓGICA DE FIRMAS POR ENDPOINT
    // ------------------------------------------------------------

    // A) payment_methods e intentos (GETs de Direct Payment) [cite: 1, 23]
    if (isPaymentMethods || isPaymentAttempt) {
      let signatureParam = '';

      if (isPaymentMethods) {
        const countryCode = urlRaw.split('/').pop().toLowerCase();
        signatureParam = `country_iso_code${countryCode}`;
      }

      const signatureBase = `${xLogin}${xDate}${signatureParam}`;
      const signature = hmacSha256Hex(secretKey, signatureBase);

      config.headers['Authorization'] = `V2-HMAC-SHA256, Signature: ${signature}`;
      return config;
    }

    // ------------------------------------------------------------
    // 2) direct_payment: (OPCIÓN ÓPTIMA - FIRMA RAW JSON)
    // ------------------------------------------------------------
    if (isDirectPayment) {
      // ✅ FIX 1: Fecha sin milisegundos (Estándar estricto de Vita)
      const xDateFixed = new Date().toISOString().split('.')[0] + 'Z';

      // ✅ FIX 2: Usar el JSON puro (bodyString) sin procesar con sorted
      // Al igual que en business_users, los objetos complejos se firman como string JSON
      const signatureBody = hasBody ? bodyString : '';
      const signatureBase = `${xLogin}${xDateFixed}${signatureBody}`;

      const signature = hmacSha256Hex(secretKey, signatureBase);

      // Sincronizamos headers
      config.headers['x-date'] = xDateFixed;
      config.headers['x-api-key'] = xTransKey;
      config.headers['x-trans-key'] = xTransKey;
      config.headers['Authorization'] = `V2-HMAC-SHA256, Signature: ${signature}`;

      if (process.env.VITA_DEBUG_SIGNATURE === 'true') {
        console.log('[vitaClient] 🚀 direct_payment OPTIMAL AUTH (RAW JSON)');
        console.log('[vitaClient] signatureBase:', signatureBase);
      }

      return config;
    }

    // C) Resto: Redirect Pay y Otros (NO TOCAR - Mantiene lo que ya funciona) 
    const signatureBody = hasBody
      ? (isBusinessUsers ? bodyString : buildSortedRequestBody(bodyObj))
      : '';

    const signatureBase = `${xLogin}${xDate}${signatureBody}`;
    const signature = hmacSha256Hex(secretKey, signatureBase);

    config.headers['Authorization'] = `V2-HMAC-SHA256, Signature: ${signature}`;

    return config;

  } catch (e) {
    console.error('[vitaClient] ❌ Interceptor crash:', e?.stack || e);
    throw e;
  }
});

// ==========================================
// Manejo de Respuestas y Reintentos
// ==========================================

client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error?.response?.status;
    const data = error?.response?.data;
    const code = data?.error?.code;
    const config = error?.config;
    const url = String(config?.url || '').toLowerCase();

    const isDirectPayment = url.includes('/direct_payment');
    const isPaymentMethods = url.includes('/payment_methods/');
    const attempt = Number(config?._vita_retry_attempt || 0);

    // ✅ Reintentar si Vita devuelve 303 (Firma Inválida) hasta 5 veces
    if ((isDirectPayment || isPaymentMethods) && status === 422 && code === 303 && attempt < 5) {
      const newConfig = {
        ...config,
        _vita_retry_attempt: attempt + 1,
        headers: { ...config.headers }
      };

      // Limpiamos el header para que el interceptor genere uno nuevo con fecha fresca
      delete newConfig.headers['Authorization'];

      if (process.env.VITA_DEBUG_SIGNATURE === 'true') {
        console.log(`[vitaClient] 🔁 Retrying ${url} (303) attempt=${attempt + 1}`);
      }

      return client.request(newConfig);
    }

    console.error(`❌ [vitaClient] Error ${status || 'NO_STATUS'} on ${url || 'NO_URL'}`);
    console.error('>> Vita Response:', JSON.stringify(data));
    return Promise.reject(error);
  }
);

export { client };