/**
 * test/helpers/signatures.js
 * Generadores de firmas HMAC para simular webhooks de Vita y Fintoc
 */
import crypto from 'crypto';

/**
 * Genera los headers HMAC-SHA256 necesarios para el IPN de Vita.
 * Reproduce exactamente lo que hace vitaSignature.js para verificar:
 *   toSign = login + date + JSON.stringify(body)
 */
export function signVitaIpn(body) {
  const login = process.env.VITA_LOGIN;
  const secret = process.env.VITA_SECRET;
  const date = new Date().toISOString();

  // IMPORTANTE: vitaSignature.js usa JSON.stringify(req.body) para construir el string
  // Con el express.json() agregado al router, req.body es el objeto parseado
  const rawPayload = JSON.stringify(body);
  const toSign = `${login}${date}${rawPayload}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(toSign)
    .digest('hex');

  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Login': login,
      'X-Date': date,
      Authorization: `V2-HMAC-SHA256, Signature: ${signature}`,
    },
  };
}

/**
 * Genera el header de firma para webhooks de Fintoc.
 * Formato: "t=timestamp,v1=hmac"
 * Payload firmado: "timestamp.JSON.stringify(body)"
 */
export function signFintocWebhook(body) {
  const secret = process.env.FINTOC_WEBHOOK_SECRET;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payloadStr = typeof body === 'string' ? body : JSON.stringify(body);
  const signedPayload = `${timestamp}.${payloadStr}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  return {
    headers: {
      'Content-Type': 'application/json',
      'fintoc-signature': `t=${timestamp},v1=${signature}`,
    },
  };
}
