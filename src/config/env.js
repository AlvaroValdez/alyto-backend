import dotenv from 'dotenv';
dotenv.config();

export const PORT = process.env.PORT || 5000;
export const MONGODB_URI = process.env.MONGODB_URI;
export const JWT_SECRET = process.env.JWT_SECRET;

// Configuración Vita Wallet
export const vita = {
  apiUrl: process.env.VITA_API_URL || 'https://api.vitawallet.io/api',
  // Asegúrate de que estos nombres sean EXACTAMENTE iguales en Render:
  apiLogin: process.env.VITA_LOGIN,
  apiSecret: process.env.VITA_SECRET_KEY, // OJO AQUÍ: ¿En Render se llama VITA_SECRET o VITA_SECRET_KEY?
  walletUUID: process.env.VITA_WALLET_ID,
};

// Validación rápida al iniciar
if (!vita.apiLogin || !vita.apiSecret) {
  console.error("⚠️  ADVERTENCIA: Faltan credenciales de Vita Wallet (Login o Secret) en las variables de entorno.");
}