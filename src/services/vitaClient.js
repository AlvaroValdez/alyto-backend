// backend/src/services/vitaClient.js
import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// =====================================================================
// 1. FUNCIONES LEGACY (CRÍTICAS PARA REDIRECT PAY - NO TOCAR)
// =====================================================================
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

// Esta es la función que SIEMPRE ha funcionado para Redirect Pay. La mantenemos.
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

// =====================================================================
// 2. NUEVA FUNCIÓN (EXCLUSIVA PARA DIRECT PAYMENT)
// =====================================================================
// Según documentación DirectPay: "concatenated without separators"
function buildDirectPaySignature(obj) {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return String(obj);

  return Object.keys(obj)
    .sort()
    .reduce((acc, key) => {
      const val = obj[key];
      if (val === undefined || val === null) return acc;

      const valString = (typeof val === 'object' && !Array.isArray(val))
        ? buildDirectPaySignature(val) // Recursividad pura
        : String(val);

      return acc + key + valString;
    }, '');
}

function hmacSha256Hex(secret, msg) {
  return crypto.createHmac('sha256', secret).update(msg, 'utf8').digest('hex');
}

// =====================================================================
// 3. CONFIGURACIÓN DEL CLIENTE E INTERCEPTOR
// =====================================================================

const client = axios.create({
  baseURL: vita.baseURL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  try {
    // --- Credenciales ---
    const xLogin = String(vita.login || '').trim();
    const xTransKey = String(vita.transKey || '').trim();
    const secretKey = String(vita.secret || '').trim();

    if (!xLogin || !xTransKey || !secretKey) {
      throw new Error('Missing Vita credentials');
    }

    // --- Metadatos ---
    const urlRaw = String(config.url || '');
    const url = urlRaw.toLowerCase();
    const method = String(config.method || 'GET').toUpperCase();

    // ⚠️ RESTAURACIÓN: Usamos ISO String normal (con ms) por defecto
    // porque así funcionaba tu Redirect Pay original.
    let xDate = new Date().toISOString();

    // --- Procesamiento de Body ---
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
      // Evitamos doble transformación
      config.transformRequest = [(data) => data];
    }
    const hasBody = Boolean(bodyString && bodyString !== '{}');

    // --- Detección de Módulo ---
    const isDirectPayment = url.includes('/direct_payment');
    const isPaymentMethods = url.includes('/payment_methods/');
    const isAttempt = url.includes('/attempts/');

    // Headers Comunes
    config.headers['x-date'] = xDate;
    config.headers['x-login'] = xLogin;
    // Redirect Pay usa x-api-key, Direct Pay usa x-trans-key. Enviamos ambos por seguridad.
    config.headers['x-trans-key'] = xTransKey;
    config.headers['x-api-key'] = xTransKey;

    let signatureBase = '';

    // ============================================================
    // CASO A: DIRECT PAYMENT (Módulo Nuevo - Lógica Estricta)
    // ============================================================
    if (isDirectPayment || isPaymentMethods || isAttempt) {

      // Fix Fecha: Direct Pay suele ser estricto con los milisegundos
      xDate = new Date().toISOString().split('.')[0] + 'Z';
      config.headers['x-date'] = xDate;

      signatureBase = `${xLogin}${xDate}`;

      if (isPaymentMethods) {
        // GET Methods: Requiere parámetro country_iso_code
        const countryCode = urlRaw.split('/').pop().toLowerCase();
        signatureBase += `country_iso_code${countryCode}`;
      }
      else if (isDirectPayment && method === 'POST') {
        // -----------------------------------------------------------------
        // LA COMBINACIÓN PERDIDA: payment_order_id + Milisegundos
        // -----------------------------------------------------------------

        // 1. Fecha: CON Milisegundos (Estándar Transaccional)
        xDate = new Date().toISOString();
        config.headers['x-date'] = xDate;

        signatureBase = `${xLogin}${xDate}`;

        // 2. Extraer ID de la URL
        const idMatch = urlRaw.match(/\/payment_orders\/([^\/]+)\/direct_payment/);
        const urlId = idMatch ? idMatch[1] : '';

        // 3. Construir Objeto de Firma
        // CAMBIO CRÍTICO: Usamos 'payment_order_id'
        const paramsToSign = {
          payment_order_id: urlId, // <--- Probamos esto CON milisegundos
          ...bodyObj
        };

        // Limpieza
        delete paramsToSign.uid;
        delete paramsToSign.id;

        // 4. Generar Firma Aplanada
        // buildDirectPaySignature ordenará: method_id -> payment_data -> payment_order_id
        const signatureBody = hasBody ? buildDirectPaySignature(paramsToSign) : '';
        signatureBase += signatureBody;

        if (process.env.VITA_DEBUG_SIGNATURE === 'true') {
          // Debería verse: ...443Zmethod_id3payment_data...payment_order_id3630
          console.log('[DirectPay POST] Base:', signatureBase);
        }
      }
      // isAttempt (GET) usa solo Login + Date (ya en base)
    }

    // ============================================================
    // CASO B: REDIRECT PAY / STANDARD (Lógica Original - RESTAURADA)
    // ============================================================
    else {
      // Esta es la lógica EXACTA que tenías antes de empezar con Direct Pay.
      // Usa buildSortedRequestBodyLegacy que incluye comillas y llaves.
      const isBusinessUsers = url.includes('/business_users');

      const signatureBody = hasBody
        ? (isBusinessUsers ? bodyString : buildSortedRequestBodyLegacy(bodyObj))
        : '';

      signatureBase = `${xLogin}${xDate}${signatureBody}`;

      if (process.env.VITA_DEBUG_SIGNATURE === 'true') {
        console.log('[Standard] Base:', signatureBase);
      }
    }

    // --- Firmar ---
    const signature = hmacSha256Hex(secretKey, signatureBase);
    config.headers['Authorization'] = `V2-HMAC-SHA256, Signature: ${signature}`;

    return config;
  } catch (e) {
    console.error('[vitaClient] Critical Error:', e);
    throw e;
  }
});

client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error?.response?.status;
    const url = String(error?.config?.url || '');

    // Solo reintentar en Direct Pay si es estrictamente necesario
    // NO reintentar en Redirect Pay para no duplicar órdenes
    if (url.includes('/direct_payment') || url.includes('/payment_methods/')) {
      const attempt = error.config._retry || 0;
      if (status === 422 && error.response?.data?.error?.code === 303 && attempt < 3) {
        error.config._retry = attempt + 1;
        return client.request(error.config);
      }
    }
    return Promise.reject(error);
  }
);

export { client };