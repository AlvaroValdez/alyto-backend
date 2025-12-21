// test-ipn.js
require('dotenv').config();   // 👈 carga .env automáticamente
const crypto = require('crypto');
const { execSync } = require('child_process');

const VITA_LOGIN = process.env.VITA_LOGIN;
const VITA_SECRET = process.env.VITA_SECRET;
const DATE = new Date().toISOString();

if (!VITA_LOGIN || !VITA_SECRET) {
  console.error("[ERROR] Variables VITA_LOGIN o VITA_SECRET no definidas en .env");
  process.exit(1);
}

const payload = JSON.stringify({
  id: "evt_123",
  type: "payment.succeeded",
  object: {
    amount: 100000,
    currency: "clp",
    country: "CO",
    order: "ORD-TEST-123"
  }
});

// Generar firma
const toSign = `${VITA_LOGIN}${DATE}${payload}`;
const hmac = crypto.createHmac('sha256', VITA_SECRET).update(toSign).digest('hex');

// Ejecutar curl directamente
const cmd = `
curl -s -X POST http://localhost:5000/api/ipn/vita \
  -H "Content-Type: application/json" \
  -H "X-Date: ${DATE}" \
  -H "X-Login: ${VITA_LOGIN}" \
  -H "Authorization: V2-HMAC-SHA256, Signature: ${hmac}" \
  -d '${payload}'
`;

console.log('[DEBUG] Ejecutando curl:\n', cmd);
const out = execSync(cmd);
console.log('Respuesta backend:', out.toString());
