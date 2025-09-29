// backend/src/config/mongo.js
const mongoose = require('mongoose');

async function connectMongo() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('[mongo] ERROR: No está definida la variable MONGO_URI');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('[mongo] Conectado a MongoDB');
  } catch (err) {
    console.error('[mongo] Error de conexión:', err);
    process.exit(1);
  }
}

module.exports = connectMongo;
