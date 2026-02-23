import 'dotenv/config'; // Carga las variables de entorno al inicio
import app from './app.js'; // Usa la sintaxis de importación moderna
import { port, isProd, vita, mongoURI } from './config/env.js';

app.listen(port, () => {
  console.log('======================================');
  console.log('🚀 Backend Alyto corriendo');
  console.log('--------------------------------------');
  console.log(`🌐 Entorno: ${isProd ? 'PRODUCCIÓN' : 'STAGE/DEV'}`);
  console.log(`📡 API Vita Base URL: ${vita.baseURL}`);
  console.log(`👤 Vita Login: ${vita.login}`);
  console.log(`🔑 Vita Wallet UUID: ${vita.walletUUID}`);
  console.log(`🗄️ Mongo URI: ${mongoURI}`);
  console.log(`🛠️ Puerto: ${port}`);
  console.log('======================================\n');
});