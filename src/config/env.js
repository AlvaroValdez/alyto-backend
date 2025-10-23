import 'dotenv/config'; 
export const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  console.error('❌ ERROR: La variable de entorno JWT_SECRET no está definida.');
  process.exit(1);
}
// Exportamos cada constante directamente
export const port = process.env.PORT || 5000;

export const isProd = process.env.NODE_ENV === 'production';

export const vita = {
  baseURL: process.env.VITA_BASE_URL,
  login: process.env.VITA_LOGIN,
  transKey: process.env.VITA_TRANS_KEY,
  secret: process.env.VITA_SECRET,
  walletUUID: process.env.VITA_BUSINESS_WALLET_UUID,
};

export const mongoURI = process.env.MONGO_URI;

