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
 * REGLA VITA: Concatenación recursiva sin separadores. 
 * Ejemplo: { a: { b: 1 } } -> "ab1"
 */
function buildVitaSignatureString(obj) {
  if (!obj || typeof obj !== 'object') return String(obj || '');

  return Object.keys(obj)
    .sort()
    .reduce((acc, key) => {
      const val = obj[key];
      if (val === undefined || val === null) return acc;

      const formattedVal = (typeof val === 'object' && !Array.isArray(val))
        ? buildVitaSignatureString(val)
        : String(val);

      return acc + key + formattedVal;
    }, '');
}

/**
 * REGLA VITA: Concatenación recursiva sin separadores (llavevalorllavevalor)
 * Usada para Direct Payment y el estándar.
 */
function buildSortedRequestBody(bodyObj) {
  if (!bodyObj || typeof bodyObj !== 'object') return String(bodyObj || '');

  const keys = Object.keys(bodyObj).sort();
  let out = '';

  for (const k of keys) {
    const v = bodyObj[k];
    if (v === undefined || v === null) continue;

    if (typeof v === 'object' && !Array.isArray(v)) {
      // RECURSIVIDAD: Concatenar la llave y llamar de nuevo para aplanar el interior
      out += `${k}${buildSortedRequestBody(v)}`;
    } else {
      // Concatenar llave + valor directamente (sin comillas ni llaves)
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
    const xLogin = String(vita.login || '').trim();
    const xTransKey = String(vita.transKey || '').trim();
    const secretKey = String(vita.secret || '').trim();

    const urlRaw = String(config.url || '');
    const url = urlRaw.toLowerCase();
    const method = config.method.toUpperCase();

    // ✅ FIX 1: Fecha sin milisegundos para sincronía total 
    const xDate = new Date().toISOString().split('.')[0] + 'Z';

    // Flags de detección
    const isPaymentMethods = url.includes('/payment_methods/');
    const isDirectPayment = url.includes('/direct_payment');
    const isAttempt = url.includes('/attempts/');

    // Headers Base
    config.headers['x-date'] = xDate;
    config.headers['x-login'] = xLogin;
    config.headers['x-trans-key'] = xTransKey;
    config.headers['x-api-key'] = xTransKey;

    let signatureBase = `${xLogin}${xDate}`;

    // ------------------------------------------------------------
    // LÓGICA DE FIRMA POR TIPO DE ENDPOINT
    // ------------------------------------------------------------

    if (isPaymentMethods) {
      // GET: Requiere parámetro country_iso_code [cite: 2, 4]
      const countryCode = urlRaw.split('/').pop().toLowerCase();
      signatureBase += `country_iso_code${countryCode}`;
    }
    else if (isDirectPayment && method === 'POST') {
      // POST: Solo firma el contenido del body (excluye IDs de URL) [cite: 12]
      let bodyData = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;

      // Limpieza preventiva: el ID de la URL NO debe estar en la firma del cuerpo [cite: 12]
      const { id, uid, ...cleanBody } = bodyData;

      signatureBase += buildVitaSignatureString(cleanBody);
    }
    else if (isAttempt) {
      // GET Intentos: Generalmente solo Login + Fecha [cite: 23]
      // signatureBase ya tiene login + date
    }
    else {
      // RESTO (Redirect Pay): Mantenemos tu lógica original para no romper lo funcional
      if (method !== 'GET' && config.data) {
        const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
        signatureBase += buildSortedRequestBody(body); // Tu función original
      }
    }

    const signature = hmacSha256Hex(secretKey, signatureBase);
    config.headers['Authorization'] = `V2-HMAC-SHA256, Signature: ${signature}`;

    return config;
  } catch (e) {
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