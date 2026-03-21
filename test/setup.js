/**
 * test/setup.js
 * Se ejecuta ANTES de cada archivo de test (setupFiles en vitest.config.js).
 * Con singleFork=true, el módulo de app.js se importa una vez y la
 * conexión MongoDB se reutiliza en todos los tests.
 */
import { beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';

// Importar la app activa la conexión MongoDB (connectMongo() en app.js)
import app from '../src/app.js'; // eslint-disable-line no-unused-vars

beforeAll(async () => {
  // Esperar a que MongoDB Atlas esté listo (asPromise() resuelve en estado "connected")
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connection.asPromise();
  }

  // Sembrar datos mínimos necesarios para tests
  await seedTestData();
}, 30000);

afterAll(async () => {
  // Limpiar documentos de test (emails @alyto-test.com y orders TEST-*)
  // No desconectamos aquí porque setup.js corre por cada archivo de test;
  // con singleFork todos comparten la misma conexión. La desconexión la
  // maneja el proceso al terminar (vitest --forceExit).
  try {
    const { default: User } = await import('../src/models/User.js');
    const { default: Transaction } = await import('../src/models/Transaction.js');
    const { default: VitaEvent } = await import('../src/models/VitaEvent.js');

    await User.deleteMany({ email: { $regex: '@alyto-test\\.com$' } });
    await Transaction.deleteMany({ order: { $regex: '^TEST-' } });
    await VitaEvent.deleteMany({ vitaId: { $regex: '^test-' } });
  } catch (e) {
    console.warn('[test/setup] cleanup error (ignorado):', e.message);
  }
});

async function seedTestData() {
  try {
    const { default: TransactionConfig } = await import('../src/models/TransactionConfig.js');

    // TransactionConfig para CL con profitRetention=true
    // Necesario para el flujo Hybrid Auto (CL→CO, CL→PE, etc.)
    await TransactionConfig.findOneAndUpdate(
      { originCountry: 'CL' },
      {
        originCountry: 'CL',
        profitRetention: true,
        profitRetentionPercent: 1.0,
        isEnabled: true,
        fintocConfig: { ufValue: 37500, tier: 1 },
      },
      { upsert: true, new: true }
    );

    // TransactionConfig para BO (manual)
    await TransactionConfig.findOneAndUpdate(
      { originCountry: 'BO' },
      {
        originCountry: 'BO',
        profitRetention: false,
        isEnabled: true,
        provider: 'internal_manual',
      },
      { upsert: true, new: true }
    );
  } catch (e) {
    console.warn('[test/setup] seedTestData error:', e.message);
  }
}

export { app };
