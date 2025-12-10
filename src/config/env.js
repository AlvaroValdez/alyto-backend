import dotenv from 'dotenv';
dotenv.config();

export const PORT = process.env.PORT || 5000;
export const MONGODB_URI = process.env.MONGODB_URI;

// --- AUTH ---
export const jwtSecret = process.env.JWT_SECRET;
// ESTA ES LA LÍNEA QUE FALTABA:
export const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';

// --- CONFIGURACIÓN VITA WALLET ---
export const vita = {
  apiUrl: process.env.VITA_API_URL || 'https://api.vitawallet.io/api',
  apiLogin: process.env.VITA_LOGIN,
  apiSecret: process.env.VITA_SECRET_KEY,
  walletUUID: process.env.VITA_WALLET_ID,
};

// Validación rápida de seguridad
if (!vita.apiLogin || !vita.apiSecret) {
  console.error("⚠️  ADVERTENCIA: Faltan credenciales de Vita Wallet en las variables de entorno.");
}