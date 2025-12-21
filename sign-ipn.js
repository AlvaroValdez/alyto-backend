// sign-ipn.js
// Genera firma HMAC V2 como Vita para testear el IPN
const crypto = require('crypto');

// Simula las credenciales de tu .env
const VITA_LOGIN = process.env.VITA_LOGIN || 'test_login';
const VITA_SECRET = process.env.VITA_SECRET || 'test_secret';

// Fecha ISO como lo manda Vita
const date = new Date().toISOString();

// Cargamos el payload de prueba
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

// Construcción del string a firmar
const toSign = `${VITA_LOGIN}${date}${payload}`;

// Generamos firma HMAC SHA256 en hex
const hmac = crypto.createHmac('sha256', VITA_SECRET);
hmac.update(toSign);
const signature = hmac.digest('hex');

// Imprimir datos para usar en curl
console.log("X-Date:", date);
console.log("X-Login:", VITA_LOGIN);
console.log("Signature:", signature);
console.log("Payload:", payload);
