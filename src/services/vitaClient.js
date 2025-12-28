import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// ==========================================
// 1. HELPERS (Lógica Legacy / JSON Estructurado)
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

// Serializa objetos en formato Ruby-like según especificación de Vita
// Ejemplo: {bank_id: "test", rut: "123"} => {:bank_id=>"test", :rut=>"123"}
// IMPORTANTE: NO ordena claves de objetos anidados (solo el objeto raíz)
function stableStringify(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object' && value.constructor === Object) {
    // IMPORTANTE: Ordenar claves alfabéticamente SIEMPRE según regla linea 425
    const keys = Object.keys(value).sort();
    const entries = keys.map(k => {
      const v = value[k];
      // Formato Ruby: :key=>"value" para strings, :key=>value para números
      if (typeof v === 'string') {
        return `:${k}=>"${v}"`;
      } else if (typeof v === 'number') {
        return `:${k}=>${v}`;
      } else if (typeof v === 'object') {
        return `:${k}=>${stableStringify(v)}`;
      }
      return `:${k}=>${v}`;
    });
    // IMPORTANTE: Unir con coma Y ESPACIO según GeneracionFirmas.txt (ej: line 69, 178)
    return `{${entries.join(', ')}}`;
  }
  return JSON.stringify(value);
}

// Construye la cadena de firma: key + stableStringify(value)
function buildSortedRequestBodyLegacy(bodyObj) {
  if (!bodyObj || typeof bodyObj !== 'object') return '';
  const keys = Object.keys(bodyObj).sort();
  let out = '';
  for (const k of keys) {
    const v = bodyObj[k];
    if (v === undefined || v === null) continue;

    // ⚠️ IMPORTANTE: Omitir objetos vacíos {} y arrays vacíos []
    // Vita no los incluye en la firma cuando están vacíos
    if (typeof v === 'object') {
      const stringified = stableStringify(v);
      // IMPORTANTE: NO omitir objetos vacíos. GeneracionFirmas.txt no tiene lógica para omitirlos.
      out += `${k}${stringified}`;
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
// 2. INTERCEPTOR (El Cerebro)
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

    // ⚠️ HEADER ESTRICTO: DirectPay exige x-trans-key y suele rechazar x-api-key
    if (url.includes('/direct_payment')) {
      config.headers['x-trans-key'] = xTransKey;
      if (config.headers['x-api-key']) delete config.headers['x-api-key'];
    } else {
      config.headers['x-trans-key'] = xTransKey;
      config.headers['x-api-key'] = xTransKey; // Redirect lo usa
    }

    let signatureBase = `${xLogin}${xDate}`;

    // -----------------------------------------------------------------------
    // LÓGICA DE FIRMA
    // -----------------------------------------------------------------------

    // CASO 1: GET Payment Methods (Firma parámetro URL)
    if (url.includes('/payment_methods/')) {
      const countryCode = urlRaw.split('/').pop().toLowerCase();
      signatureBase += `country_iso_code${countryCode}`;
    }
    // CASO 2: POST Direct Payment (Firma SOLO Body, SIN id)
    else if (url.includes('/direct_payment') && method === 'POST') {
      // Para DirectPay, NO incluir id en la firma, solo el body
      // Según documentación, la firma es: x_login + x_date + sorted_body
      // Para DirectPay, NO incluir id en la firma, solo el body
      // Según documentación, la firma es: x_login + x_date + sorted_body
      const cleanBody = { ...bodyObj };
      delete cleanBody.id;
      delete cleanBody.uid;
      delete cleanBody.payment_order_id;

      // Generar firma solo con el body
      signatureBase += buildSortedRequestBodyLegacy(cleanBody);

      // Log siempre activo para debugging
      console.log('[DirectPay] URL:', urlRaw);
      console.log('[DirectPay] Body enviado:', JSON.stringify(bodyObj, null, 2));
      // console.log('[DirectPay] Params para firma (SIN id):', JSON.stringify(cleanBody, null, 2));
      console.log('[DirectPay] SignatureBase (con ID):', signatureBase);
    }
    // CASO 3: POST Redirect Payment / Create Order (Firma solo Body)
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
    // Log detallado para depurar
    if (error.response?.status === 422 || error.response?.status === 401) {
      console.error('⚠️ [Vita Error Response]', JSON.stringify(error.response.data));
    }
    return Promise.reject(error);
  }
);

export { client };