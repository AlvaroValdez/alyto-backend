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

// Mantiene la estructura JSON para objetos anidados (payment_data)
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

// Función de firma estándar (Redirect Pay Style)
function buildSortedRequestBodyLegacy(bodyObj) {
  if (!bodyObj || typeof bodyObj !== 'object') return '';
  const keys = Object.keys(bodyObj).sort();
  let out = '';
  for (const k of keys) {
    const v = bodyObj[k];
    if (v === undefined || v === null) continue;

    // Si es objeto, se usa su string JSON. Si es primitivo, su valor string.
    if (typeof v === 'object') {
      out += `${k}${stableStringify(v)}`;
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

    // 1. FECHA CON MILISEGUNDOS (Requerido para validación correcta)
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
    config.headers['x-trans-key'] = xTransKey;
    config.headers['x-api-key'] = xTransKey;

    let signatureBase = `${xLogin}${xDate}`;

    // ============================================================
    // LÓGICA DE FIRMA
    // ============================================================

    // CASO GET: Parámetros de URL en la firma
    if (url.includes('/payment_methods/')) {
      const countryCode = urlRaw.split('/').pop().toLowerCase();
      signatureBase += `country_iso_code${countryCode}`;
    }
    // CASO POST (Direct & Redirect): Firma solo el Body (Legacy JSON)
    else if (hasBody) {
      // Limpiamos IDs de URL que no deben ir en la firma del body
      const cleanBody = { ...bodyObj };
      delete cleanBody.id;
      delete cleanBody.uid;
      delete cleanBody.payment_order_id;

      // Usamos la firma Legacy (JSON estructurado)
      signatureBase += buildSortedRequestBodyLegacy(cleanBody);
    }

    if (process.env.VITA_DEBUG_SIGNATURE === 'true' && url.includes('/direct_payment')) {
      console.log('[DirectPay] SignatureBase:', signatureBase);
    }

    const signature = hmacSha256Hex(secretKey, signatureBase);
    config.headers['Authorization'] = `V2-HMAC-SHA256, Signature: ${signature}`;

    return config;
  } catch (e) {
    throw e;
  }
});

// Interceptor de respuesta para logs claros
client.interceptors.response.use(
  (res) => res,
  async (error) => {
    // Loguear errores detallados de validación (422)
    if (error.response?.status === 422) {
      console.error('⚠️ [Vita Validation Error]', JSON.stringify(error.response.data));
    }
    return Promise.reject(error);
  }
);

export { client };