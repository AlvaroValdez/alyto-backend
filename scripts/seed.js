import 'dotenv/config'; // Carga las variables de entorno
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs'; // Necesario si queremos verificar, aunque el hash es automático
import User from '../src/models/User.js';
import Markup from '../src/models/Markup.js';
import connectMongo from '../src/config/mongo.js'; // Usa tu función de conexión

// Función principal asíncrona para usar await
const seedDatabase = async () => {
  console.log('🌱 Iniciando script de seeding...');

  try {
    // 1. Conectar a la base de datos
    await connectMongo(); // Espera a que la conexión se establezca

    // 2. Limpiar colecciones existentes (¡CUIDADO EN PRODUCCIÓN!)
    console.log('🧹 Limpiando colecciones Users y Markups...');
    await User.deleteMany({});
    await Markup.deleteMany({});
    console.log('👍 Colecciones limpiadas.');

    // 3. Crear usuario Administrador
    const adminData = {
      name: process.env.DEFAULT_ADMIN_NAME || 'Admin',
      email: process.env.DEFAULT_ADMIN_EMAIL,
      password: process.env.DEFAULT_ADMIN_PASSWORD,
      role: 'admin', // Asigna explícitamente el rol
    };
    if (!adminData.email || !adminData.password) {
        throw new Error('Faltan variables de entorno para el usuario admin.');
    }
    const adminUser = new User(adminData);
    await adminUser.save(); // La contraseña se hashea aquí
    console.log(`👤 Usuario Admin creado: ${adminUser.email}`);

    // 4. Crear usuario Normal
    const userData = {
      name: process.env.DEFAULT_USER_NAME || 'User',
      email: process.env.DEFAULT_USER_EMAIL,
      password: process.env.DEFAULT_USER_PASSWORD,
      role: 'user', // Rol por defecto, pero lo ponemos explícito
    };
     if (!userData.email || !userData.password) {
        throw new Error('Faltan variables de entorno para el usuario normal.');
    }
    const normalUser = new User(userData);
    await normalUser.save();
    console.log(`👤 Usuario Normal creado: ${normalUser.email}`);

    // 5. Crear configuración de Markup por defecto
    const markupData = {
      defaultPercent: 3, // O el valor que prefieras
      pairs: [],
    };
    await Markup.create(markupData);
    console.log(`💲 Configuración de Markup creada con ${markupData.defaultPercent}% por defecto.`);

    console.log('✅ Seeding completado exitosamente.');

  } catch (error) {
    console.error('❌ Error durante el seeding:', error);
    process.exit(1); // Termina el script con un código de error
  } finally {
    // 6. Desconectar de la base de datos
    await mongoose.disconnect();
    console.log('🔌 Desconectado de MongoDB.');
  }
};

// Ejecutar la función de seeding
seedDatabase();