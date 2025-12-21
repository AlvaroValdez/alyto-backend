// backend/src/config/env.js
import 'dotenv/config';

export const port = process.env.PORT || 5000;
export const isProd = process.env.NODE_ENV === 'production';
export const mongoURI = process.env.MONGO_URI;
export const jwtSecret = process.env.JWT_SECRET;
export const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '1d';

const vitaOrigin = (process.env.VITA_API_URL || '').replace(/\/+$/, '');

export const vita = {
  // ✅ Base URL correcto según doc: .../api/businesses
  baseURL: `${vitaOrigin}/api/businesses`,

  // (útil si algún día necesitas pegarle a otra ruta fuera de /api/businesses)
  origin: vitaOrigin,

  // ✅ CHECKOUT: Dominio específico para checkout de pagos
  checkoutBaseURL: process.env.VITA_CHECKOUT_BASE_URL || 'https://checkout.stage.vitawallet.io',

  login: process.env.VITA_LOGIN,
  transKey: process.env.VITA_TRANS_KEY,
  secret: process.env.VITA_SECRET || process.env.VITA_SECRET_KEY,
  walletUUID: process.env.VITA_BUSINESS_WALLET_UUID,
  notifyUrl: process.env.VITA_NOTIFY_URL,
};