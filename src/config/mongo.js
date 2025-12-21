// backend/src/config/mongo.js
import mongoose from 'mongoose';

const connectMongo = async () => {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('[mongo] ERROR: No está definida la variable MONGO_URI');
    process.exit(1);
  }

  try {
    // Las opciones useNewUrlParser y useUnifiedTopology ya no son necesarias
    await mongoose.connect(uri);
    console.log('[mongo] Conectado a MongoDB');
  } catch (err) {
    console.error('[mongo] Error de conexión:', err);
    process.exit(1);
  }
};

export default connectMongo;
