import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
dotenv.config();

// Mongoose connection
await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

// Load models
const User = (await import('./src/models/User.js')).default;
const fcmService = await import('./src/services/fcmService.js');

async function test() {
    const users = await User.find({ fcmToken: { $exists: true, $ne: null } }).select('email fcmToken');
    console.log(`[TEST] Encontrados ${users.length} usuarios con fcmToken.`);

    for (let user of users) {
        console.log(`[TEST] Enviando push a: ${user.email} con token: ${user.fcmToken.slice(-10)}...`);
        const res = await fcmService.notifyUser(user._id, {
            title: "Notificación de Prueba 🚀",
            body: "Si ves esto, Firebase Cloud Messaging está funcionando.",
            data: { type: "test", url: "/" }
        });
        console.log(`[TEST] Resultado para ${user.email}:`, res);
    }

    console.log("[TEST] Terminado.");
    process.exit(0);
}

test().catch(console.error);
