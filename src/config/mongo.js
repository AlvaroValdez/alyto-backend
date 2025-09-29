// backend/src/config/mongo.js
const mongoose = require('mongoose');

async function connectMongo() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('[mongo] No está definida la variable MONGODB_URI');
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
