// src/services/fcmService.js
// Firebase Cloud Messaging - Servicio de notificaciones push
import admin from 'firebase-admin';
import { createRequire } from 'module';
import User from '../models/User.js';

const require = createRequire(import.meta.url);

let initialized = false;

const initFirebase = () => {
    if (initialized) return;
    try {
        let serviceAccount;

        // 1. Intentar variable de entorno (JSON stringificado)
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        } else {
            // 2. Intentar archivo local (desarrollo)
            try {
                serviceAccount = require('../../firebase-service-account.json');
            } catch (e1) {
                // 3. Intentar Secret File de Render (producción)
                try {
                    serviceAccount = require('/etc/secrets/firebase-service-account.json');
                } catch (e2) {
                    throw new Error('No se encontró firebase-service-account.json ni en local ni en /etc/secrets/');
                }
            }
        }

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        initialized = true;
        console.log('✅ [FCM] Firebase Admin inicializado');
    } catch (err) {
        console.error('❌ [FCM] Error inicializando Firebase Admin:', err.message);
    }
};

// Inicializar al importar
initFirebase();

/**
 * Enviar push a un dispositivo específico por token
 */
export const sendPushNotification = async ({ token, title, body, data = {} }) => {
    if (!token) return { skipped: true, reason: 'no_token' };

    try {
        // Convertir todos los valores de data a strings (requerido por FCM)
        const stringData = Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v)])
        );

        const result = await admin.messaging().send({
            token,
            notification: { title, body },
            data: stringData,
            webpush: {
                notification: {
                    title,
                    body,
                    icon: '/logo192.png',
                    badge: '/badge.png',
                    requireInteraction: false
                },
                fcmOptions: {
                    link: data.url || '/'
                }
            }
        });

        console.log(`✅ [FCM] Push enviada: ${title} → token ...${token.slice(-8)}`);
        return { success: true, messageId: result };

    } catch (err) {
        // Token expirado/inválido → limpiarlo de la BD
        if (
            err.code === 'messaging/registration-token-not-registered' ||
            err.code === 'messaging/invalid-registration-token'
        ) {
            console.warn(`[FCM] Token inválido, limpiando de BD: ...${token.slice(-8)}`);
            await User.findOneAndUpdate({ fcmToken: token }, { $unset: { fcmToken: 1 } });
        } else {
            console.error(`❌ [FCM] Error enviando push: ${err.message}`);
        }
        return { success: false, error: err.message };
    }
};

/**
 * Enviar push a un usuario por su userId
 */
export const notifyUser = async (userId, { title, body, data = {} }) => {
    if (!userId) return;
    try {
        const user = await User.findById(userId).select('fcmToken');
        if (!user?.fcmToken) return { skipped: true, reason: 'user_no_token' };
        return sendPushNotification({ token: user.fcmToken, title, body, data });
    } catch (err) {
        console.error(`[FCM] Error buscando usuario ${userId}:`, err.message);
    }
};

/**
 * Enviar push a todos los admins
 */
export const notifyAdmins = async ({ title, body, data = {} }) => {
    try {
        const admins = await User.find({
            role: 'admin',
            fcmToken: { $exists: true, $ne: null }
        }).select('fcmToken name');

        if (!admins.length) {
            console.log('[FCM] No hay admins con token FCM registrado');
            return;
        }

        const results = await Promise.allSettled(
            admins.map(admin =>
                sendPushNotification({ token: admin.fcmToken, title, body, data })
            )
        );

        const sent = results.filter(r => r.status === 'fulfilled').length;
        console.log(`✅ [FCM] Push a admins: ${sent}/${admins.length} enviadas`);
        return results;

    } catch (err) {
        console.error('[FCM] Error notificando admins:', err.message);
    }
};
