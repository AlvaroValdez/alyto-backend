// backend/src/config/env.js
const required = [
  'VITA_BASE_URL',
  'VITA_LOGIN',
  'VITA_TRANS_KEY',
  'VITA_SECRET',
  'VITA_BUSINESS_WALLET_UUID',
  'MONGO_URI'
];

for (const k of required) {
  if (!process.env[k]) {
    throw new Error(`[env] Falta variable requerida: ${k}`);
  }
}

module.exports = {
  port: process.env.PORT || 5000,
  isProd: process.env.NODE_ENV === 'production',
  vita: {
    baseURL: process.env.VITA_BASE_URL,
    login: process.env.VITA_LOGIN,
    transKey: process.env.VITA_TRANS_KEY,
    secret: process.env.VITA_SECRET,
    walletUUID: process.env.VITA_BUSINESS_WALLET_UUID,
  },
  mongoURI: process.env.MONGO_URI,
  verifyIpn: process.env.VITA_IPN_VERIFY_SIGNATURE === '1',
};
