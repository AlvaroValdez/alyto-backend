import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.js'],
    include: ['test/e2e/**/*.test.js'],
    testTimeout: 45000,   // APIs externas pueden tardar
    hookTimeout: 30000,
    // Todos los tests en un solo proceso — comparten conexión MongoDB y caché de módulos
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
        // Sin isolación: todos los archivos comparten el módulo cache (evita OverwriteModelError)
        isolate: false,
      }
    },
    // No parar al primer fallo — queremos ver todos los resultados
    bail: 0,
    reporter: 'verbose',
    // Variables de entorno para el proceso de test
    // dotenv NO sobrescribe vars ya definidas, así que estas tienen prioridad sobre .env
    env: {
      NODE_ENV: 'test',
      // Base de datos separada para tests — misma credencial, diferente DB
      MONGO_URI: 'mongodb+srv://app_user:vlow7LV14FLd0aNE@avf-vita.oh8gqvz.mongodb.net/remesas-test?retryWrites=true&w=majority&appName=avf-vita',
      // Clave inválida → email falla con 401 → emailService retorna { success: false } gracefully
      RESEND_API_KEY: 're_test_INVALID_KEY_FOR_TESTING',
      // Frontend URL para links de verificación en tests
      // Fintoc sandbox requiere HTTPS — usamos el dominio real (no se navega realmente en tests)
      FRONTEND_URL: 'https://app.alyto.io',
    }
  }
});
