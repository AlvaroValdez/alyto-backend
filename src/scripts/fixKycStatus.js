/**
 * fixKycStatus.js
 * 
 * Corrige usuarios auto-aprobados por el bug del pre-save hook:
 *  - kyc.level=1 + status='approved' → fueron auto-aprobados (NO por admin)
 *  - Regla: admin approval pone level=2, así que level=1+'approved' = bug
 * 
 * Reset:
 *  - Si tiene documentos subidos → status='pending' (listo para revisión)
 *  - Si NO tiene documentos    → status='unverified' (nunca completó KYC)
 * 
 * Usuarios con level>=2 + status='approved' → son aprobaciones reales por admin → NO SE TOCAN
 */

import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI no definido en .env'); process.exit(1); }

await mongoose.connect(MONGO_URI);
console.log('✅ Conectado a MongoDB\n');

const User = (await import('../models/User.js')).default;

// 1. Listar todos los usuarios
const allUsers = await User.find({}, 'email name kyc.status kyc.level kyc.documents').lean();
console.log(`👥 Total usuarios: ${allUsers.length}`);
allUsers.forEach(u => {
    const docs = u.kyc?.documents;
    const hasDocs = docs && (docs.idFront || docs.selfie || docs.idBack);
    console.log(`  ${u.email} → level=${u.kyc?.level}, status=${u.kyc?.status} ${hasDocs ? '(docs subidos)' : '(sin docs)'}`);
});

// 2. Identificar auto-aprobados: level=1 con status='approved'
const autoApproved = allUsers.filter(u => u.kyc?.level <= 1 && u.kyc?.status === 'approved');
console.log(`\n⚠️  Usuarios auto-aprobados a corregir: ${autoApproved.length}`);

if (autoApproved.length === 0) {
    console.log('✅ No hay usuarios a corregir. BD limpia.');
    await mongoose.disconnect();
    process.exit(0);
}

// 3. Corregir cada uno
let fixed = 0;
for (const u of autoApproved) {
    const docs = u.kyc?.documents;
    const hasDocs = docs && (docs.idFront || docs.selfie || docs.idBack);
    const newStatus = hasDocs ? 'pending' : 'unverified';

    await User.updateOne(
        { _id: u._id },
        { $set: { 'kyc.status': newStatus } }
    );
    console.log(`  ✅ ${u.email}: 'approved' → '${newStatus}'`);
    fixed++;
}

console.log(`\n✅ ${fixed} usuario(s) corregido(s).`);
console.log('ℹ️  Usuarios con level>=2+approved (aprobados por admin) NO fueron tocados.');

await mongoose.disconnect();
process.exit(0);
