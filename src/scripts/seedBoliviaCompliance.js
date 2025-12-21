// backend/src/scripts/seedBoliviaCompliance.js
import mongoose from 'mongoose';
import 'dotenv/config';
import { seedBoliviaLimits } from '../services/complianceService.js';
import { mongoURI } from '../config/env.js';

/**
 * Script para inicializar límites de cumplimiento de Bolivia
 * Ejecutar: node src/scripts/seedBoliviaCompliance.js
 */

async function main() {
    try {
        console.log('🔄 Conectando a MongoDB...');
        await mongoose.connect(mongoURI);
        console.log('✅ Conectado a MongoDB');

        console.log('🇧🇴 Inicializando límites de Bolivia (ASFI)...');
        await seedBoliviaLimits();

        console.log('✅ Proceso completado exitosamente');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

main();
