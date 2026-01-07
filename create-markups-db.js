import mongoose from 'mongoose';
import Markup from './src/models/Markup.js';
import dotenv from 'dotenv';

dotenv.config();

const createMarkups = async () => {
    try {
        console.log('🔌 Conectando a MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Conectado a MongoDB\n');

        // Limpiar markups existentes
        console.log('🗑️  Limpiando markups antiguos...');
        await Markup.deleteMany({});
        console.log('✅ Markups antiguos eliminados\n');

        // 1. Crear markup global por defecto (2%)
        console.log('1️⃣  Creando markup global por defecto (2%)...');
        const globalDefault = await Markup.create({
            isDefault: true,
            percent: 2.0,
            description: 'Spread global por defecto (2%)'
        });
        console.log('✅ Creado:', globalDefault._id);

        // 2. Crear markup default para Chile (2%)
        console.log('\n2️⃣  Creando markup default para Chile (2%)...');
        const clDefault = await Markup.create({
            originCountry: 'CL',
            percent: 2.0,
            description: 'Default para Chile - aplica a todos los destinos'
        });
        console.log('✅ Creado:', clDefault._id);

        // 3. Crear markup específico CL → CO (2.5%)
        console.log('\n3️⃣  Creando markup CL → CO (2.5%)...');
        const clCo = await Markup.create({
            originCountry: 'CL',
            destCountry: 'CO',
            percent: 2.5,
            description: 'Chile → Colombia (corredor principal)'
        });
        console.log('✅ Creado:', clCo._id);

        // 4. Crear markup específico CL → PE (3%)
        console.log('\n4️⃣  Creando markup CL → PE (3%)...');
        const clPe = await Markup.create({
            originCountry: 'CL',
            destCountry: 'PE',
            percent: 3.0,
            description: 'Chile → Perú'
        });
        console.log('✅ Creado:', clPe._id);

        // Listar todos
        console.log('\n📋 Verificando markups creados:');
        const allMarkups = await Markup.find();
        console.log(JSON.stringify(allMarkups, null, 2));

        console.log('\n✅ ¡Markups creados exitosamente!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

createMarkups();
