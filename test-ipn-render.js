// test-ipn-render.js
require('dotenv').config();
const crypto = require('crypto');
const { execSync } = require('child_process');

// Credenciales de Vita desde .env
const VITA_LOGIN = process.env.VITA_LOGIN;
const VITA_SECRET = process.env.VITA_SECRET;
const DATE = new Date().toISOString();

if (!VITA_LOGIN || !VITA_SECRET) {
  console.error("[ERROR] Variables VITA_LOGIN o VITA_SECRET no definidas en .env");
  process.exit(1);
}

// Payload de prueba (simulando Vita)
const payload = JSON.stringify({
  id: "evt_123",
  type: "payment.succeeded",
  object: {
    amount: 100000,
    currency: "clp",
    country: "CO",
    order: "ORD-TEST-RENDER"
  }
});

// Generar firma
const toSign = `${VITA_LOGIN}${DATE}${payload}`;
const hmac = crypto.createHmac('sha256', VITA_SECRET).update(toSign).digest('hex');

// Ejecutar curl contra Render
const cmd = `
curl -s -X POST https://remesas-avf1-0.onrender.com/api/ipn/vita \
  -H "Content-Type: application/json" \
  -H "X-Date: ${DATE}" \
  -H "X-Login: ${VITA_LOGIN}" \
  -H "Authorization: V2-HMAC-SHA256, Signature: ${hmac}" \
  -d '${payload}'
`;

console.log('[DEBUG] Ejecutando curl contra Render:\n', cmd);
const out = execSync(cmd);
console.log('Respuesta backend (Render):', out.toString());
