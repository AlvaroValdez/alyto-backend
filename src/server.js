// backend/src/server.js
require('dotenv').config();
const { port, isProd, vita, mongoURI } = require('./config/env');
const app = require('./app');

app.listen(port, () => {
  console.log('======================================');
  console.log('🚀 Backend AVF Remesas corriendo');
  console.log('--------------------------------------');
  console.log(`🌐 Entorno: ${isProd ? 'PRODUCCIÓN' : 'STAGE/DEV'}`);
  console.log(`📡 API Vita Base URL: ${vita.baseURL}`);
  console.log(`👤 Vita Login: ${vita.login}`);
  console.log(`🔑 Vita Wallet UUID: ${vita.walletUUID}`);
  console.log(`🗄️ Mongo URI: ${mongoURI}`);
  console.log(`🛠️ Puerto local: http://localhost:${port}`);
  console.log('======================================\n');
});
