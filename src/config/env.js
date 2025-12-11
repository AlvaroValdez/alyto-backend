import dotenv from 'dotenv';
dotenv.config();

// --- GENERAL ---
export const port = process.env.PORT || 5000;
export const isProd = process.env.NODE_ENV === 'production';
export const PORT = port;

// --- BASE DE DATOS ---
export const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI; // Agregué fallback por si acaso
export const MONGODB_URI = mongoURI;

// --- AUTENTICACIÓN ---
export const jwtSecret = process.env.JWT_SECRET;
export const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';

// --- VITA WALLET ---
export const vita = {
  apiUrl: process.env.VITA_BASE_URL || 'https://api.stage.vitawallet.io', // Usar variable correcta del .env
  apiLogin: process.env.VITA_LOGIN,      // e0f5e...

  // AQUÍ ESTABA EL ERROR: Faltaba mapear la Trans Key
  apiKey: process.env.VITA_TRANS_KEY,    // s+OtCG... (La llave corta)

  apiSecret: process.env.VITA_SECRET_KEY,// f0fbe... (El secreto largo)
  walletUUID: process.env.VITA_BUSINESS_WALLET_UUID,
};

// Validación de seguridad al inicio
if (!vita.apiLogin || !vita.apiKey || !vita.apiSecret) {
  console.error("⚠️  CRITICAL: Faltan credenciales de Vita Wallet (Login, TransKey o Secret).");
}