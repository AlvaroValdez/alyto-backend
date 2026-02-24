import admin from 'firebase-admin';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const serviceAccount = require('./firebase-service-account.json');

console.log('[DEBUG] Inicializando Firebase...');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// A dummy FCM token (if you want to test, you need to replace this with your actual device token from the browser console)
const dummyToken = "d1x2...";

console.log('[DEBUG] Listo. Para probar, escribe en tu consola del navegador frontend:');
console.log('localStorage.getItem("fcmToken")');
console.log('Y luego pégalo aquí editando el test-push-2.js en la línea 12, para ver si llega.');
console.log('[DEBUG] Firebase inicializado sin errores.');
process.exit(0);
