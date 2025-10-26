import 'dotenv/config'; 

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
export const jwtSecret = process.env.JWT_SECRET;
// --- ASEGÚRATE DE QUE ESTA LÍNEA EXISTA Y SEA CORRECTA ---
export const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '1d'; // Exporta jwtExpiresIn

// Verificaciones
if (!jwtSecret) {
  console.error('❌ ERROR: La variable de entorno JWT_SECRET no está definida.');
  process.exit(1);
}
if (!mongoURI) { // Añade verificación para mongoURI también
    console.error('❌ ERROR: La variable de entorno MONGO_URI no está definida.');
    process.exit(1);
}

