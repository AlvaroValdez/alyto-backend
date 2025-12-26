import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// ==========================================
// 1. HELPERS LEGACY (ESTÁNDAR VITA)
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

// Helper para mantener estructura JSON {"a":"b"} ordenada
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

// Función de firma Legacy (JSON Style)
function buildSortedRequestBodyLegacy(bodyObj) {
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

// ==========================================
// 2. CONFIGURACIÓN CLIENTE
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

    // 1. FECHA CON MILISEGUNDOS
    const xDate = new Date().toISOString();

    const urlRaw = String(config.url || '');
    const url = urlRaw.toLowerCase();
    const method = String(config.method || 'GET').toUpperCase();

    // Procesar Body
    let bodyObj;
    let bodyString = '';
    if (method !== 'GET' && config.data) {
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

    // Headers Base
    config.headers['x-date'] = xDate;
    config.headers['x-login'] = xLogin;

    // Header Estricto: Solo x-trans-key para Direct Pay
    if (url.includes('/direct_payment')) {
      config.headers['x-trans-key'] = xTransKey;
      delete config.headers['x-api-key'];
    } else {
      config.headers['x-trans-key'] = xTransKey;
      config.headers['x-api-key'] = xTransKey;
    }

    let signatureBase = `${xLogin}${xDate}`;

    // ============================================================
    // LÓGICA DE FIRMA
    // ============================================================

    // CASO GET: Parámetros de URL
    if (url.includes('/payment_methods/')) {
      const countryCode = urlRaw.split('/').pop().toLowerCase();
      signatureBase += `country_iso_code${countryCode}`;
    }
    // ✅ CASO DIRECT PAY: Legacy + ID al principio
    else if (url.includes('/direct_payment') && method === 'POST') {

      // 1. Extraer ID
      const idMatch = urlRaw.match(/\/payment_orders\/([^\/]+)\/direct_payment/);
      const urlId = idMatch ? idMatch[1] : '';

      // 2. Construir objeto de firma con 'id'
      // 'id' empieza con 'i', que es menor que 'm' (method_id) y 'p' (payment_data)
      // Por lo tanto, quedará al principio de la cadena del body.
      const paramsToSign = {
        id: urlId, // <--- Usamos 'id' corto
        ...bodyObj
      };

      // Limpieza de seguridad
      delete paramsToSign.uid;
      delete paramsToSign.payment_order_id;

      // 3. Firma LEGACY (JSON con separadores)
      // Generará: id3650method_id3payment_data{"bank_id":"..."}
      signatureBase += buildSortedRequestBodyLegacy(paramsToSign);

      if (process.env.VITA_DEBUG_SIGNATURE === 'true') {
        console.log('[DirectPay] SignatureBase (Legacy + ID):', signatureBase);
      }
    }
    // CASO REDIRECT PAY
    else if (hasBody) {
      const cleanBody = { ...bodyObj };
      delete cleanBody.id;
      delete cleanBody.uid;
      delete cleanBody.payment_order_id;
      signatureBase += buildSortedRequestBodyLegacy(cleanBody);
    }

    const signature = hmacSha256Hex(secretKey, signatureBase);
    config.headers['Authorization'] = `V2-HMAC-SHA256, Signature: ${signature}`;

    return config;
  } catch (e) {
    throw e;
  }
});

client.interceptors.response.use(
  (res) => res,
  async (error) => {
    // Logueamos siempre para ver si es 303 o 305/etc
    if (error.response?.status === 422) {
      console.error('⚠️ [Vita Validation Error]', JSON.stringify(error.response.data));
    }
    return Promise.reject(error);
  }
);

export { client };