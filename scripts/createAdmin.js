import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import connectMongo from '../src/config/mongo.js';

const createAdminUser = async () => {
  console.log('👑 Iniciando creación de Super Admin...');

  try {
    // 1. Conectar a la base de datos
    await connectMongo();
    
    // DIAGNÓSTICO: Ver a qué base de datos nos conectamos
    const dbName = mongoose.connection.name;
    const host = mongoose.connection.host;
    console.log(`📊 Conectado a la base de datos: "${dbName}" en ${host}`);

    const email = process.env.ADMIN_EMAIL || 'avfinancecl@gmail.com';
    const password = process.env.ADMIN_PASSWORD || '123456'; 
    const name = process.env.ADMIN_NAME || 'Admin AVF';

    console.log(`🔍 Buscando usuario: ${email}`);

    // 2. Verificar si ya existe
    const existingAdmin = await User.findOne({ email: email.toLowerCase() });
    
    if (existingAdmin) {
      console.log(`⚠️ El usuario ${email} ya existe.`);
      
      // Actualizamos datos clave
      existingAdmin.role = 'admin';
      existingAdmin.isEmailVerified = true;
      
      // FORZAR ACTUALIZACIÓN DE CONTRASEÑA
      // Esto es vital: si no reasignamos la contraseña, el middleware de hash no se activa
      // y no podrías entrar con la nueva contraseña del .env
      existingAdmin.password = password; 
      
      // Completar perfil si falta
      if (!existingAdmin.firstName) existingAdmin.firstName = 'Administrador';
      if (!existingAdmin.lastName) existingAdmin.lastName = 'Sistema';
      
      await existingAdmin.save();
      console.log('✅ Usuario actualizado: Rol Admin y Contraseña reestablecida.');
      return;
    }

    // 3. Crear nuevo usuario si no existe
    const newAdmin = new User({
      name: name,
      email: email,
      password: password,
      role: 'admin',
      isEmailVerified: true,
      // Datos de perfil para evitar bloqueos de KYC
      firstName: 'Administrador',
      lastName: 'Principal',
      documentType: 'RUT',
      documentNumber: '11111111-1',
      phoneNumber: '+56900000000',
      address: 'Oficina Central',
      birthDate: new Date('1990-01-01'),
      kyc: {
        level: 2,
        status: 'approved',
        verifiedAt: new Date()
      },
      isProfileComplete: true
    });

    await newAdmin.save();
    console.log(`🎉 Usuario Admin creado exitosamente: ${newAdmin.email}`);

  } catch (error) {
    console.error('❌ Error creando el admin:', error);
    // Si es error de validación, mostrar detalles
    if (error.name === 'ValidationError') {
        console.error('Detalles de validación:', error.errors);
    }
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Desconectado.');
    process.exit();
  }
};

createAdminUser();