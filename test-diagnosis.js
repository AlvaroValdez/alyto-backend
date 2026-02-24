import mongoose from 'mongoose';
import admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
dotenv.config();

console.log('--- TEST FIREBASE PUSH ---');

async function run() {
    try {
        console.log('Conectando a MongoDB...', process.env.MONGO_URI?.slice(0, 20) + '...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Conectado a MongoDB.');

        const User = (await import('./src/models/User.js')).default;

        const usersWithToken = await User.find({ fcmToken: { $exists: true, $ne: null } }).select('email name fcmToken role');
        console.log(`Encontrados ${usersWithToken.length} usuarios con fcmToken registrado en la BD.`);

        if (usersWithToken.length === 0) {
            console.log('❌ ERROR: Ningún usuario tiene un FCM token en la base de datos. El frontend no está guardando el token.');
            process.exit(1);
        }

        console.log('Inicializando Firebase Admin...');
        const serviceAccount = require('./firebase-service-account.json');

        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        }
        console.log('Firebase Admin inicializado.');

        for (const user of usersWithToken.slice(0, 3)) { // Test solo los primeros 3
            console.log(`\nEnviando prueba a: ${user.email} (${user.role})`);
            console.log(`Token: ...${user.fcmToken.slice(-15)}`);

            const message = {
                token: user.fcmToken,
                notification: {
                    title: 'Notificación de Prueba 🚀',
                    body: 'Mensaje de diagnóstico para verificar el flujo FCM.'
                },
                data: {
                    type: 'test_diagnosis',
                    url: '/'
                },
                webpush: {
                    notification: {
                        title: 'Notificación de Prueba Vía Webpush 🚀',
                        body: 'Diagnóstico FCM.',
                        icon: '/logo192.png'
                    }
                }
            };

            try {
                const response = await admin.messaging().send(message);
                console.log(`✅ EXITO: Mensaje enviado a ${user.email}. MessageId:`, response);
            } catch (err) {
                console.error(`❌ FALLO para ${user.email}:`, err.code, err.message);
            }
        }

    } catch (e) {
        console.error('Error general del script:', e);
    } finally {
        await mongoose.disconnect();
        console.log('Test finalizado.');
        process.exit(0);
    }
}

run();
