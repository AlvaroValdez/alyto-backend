// backend/src/config/mongo.js
const mongoose = require('mongoose');

async function connectMongo(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log('[mongo] Conectado');
}

module.exports = { connectMongo };
