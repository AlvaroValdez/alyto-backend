import dotenv from 'dotenv';
dotenv.config();

// --- GENERAL ---
// server.js pide 'port' y 'isProd'
export const port = process.env.PORT || 5000;
export const isProd = process.env.NODE_ENV === 'production';

// Alias en mayúsculas por si otros archivos lo buscan así
export const PORT = port;

// --- BASE DE DATOS ---
// server.js pide 'mongoURI'
export const mongoURI = process.env.MONGODB_URI;
// Alias estándar
export const MONGODB_URI = mongoURI;

// --- AUTENTICACIÓN ---
// auth.js y middlewares piden estos
export const jwtSecret = process.env.JWT_SECRET;
export const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';

// --- VITA WALLET ---
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