import dotenv from 'dotenv';
dotenv.config();

export const PORT = process.env.PORT || 5000;
export const MONGODB_URI = process.env.MONGODB_URI;

// CORRECCIÓN: Usamos 'jwtSecret' (minúsculas) para compatibilidad con authMiddleware
export const jwtSecret = process.env.JWT_SECRET;

// Configuración Vita Wallet
export const vita = {
  apiUrl: process.env.VITA_API_URL || 'https://api.vitawallet.io/api',
  apiLogin: process.env.VITA_LOGIN,
  apiSecret: process.env.VITA_SECRET_KEY,
  walletUUID: process.env.VITA_WALLET_ID,
};

// Validación rápida al iniciar
if (!vita.apiLogin || !vita.apiSecret) {
  console.error("⚠️  ADVERTENCIA: Faltan credenciales de Vita Wallet (Login o Secret) en las variables de entorno.");
}