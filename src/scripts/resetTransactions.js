// backend/src/scripts/resetTransactions.js
// Script para limpiar transacciones de prueba
// Uso: node src/scripts/resetTransactions.js

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cargar .env desde la raíz del backend
dotenv.config({ path: join(__dirname, '../../.env') });

// Importar modelos
import Transaction from '../models/Transaction.js';

async function resetTransactions() {
    try {
        console.log('🔄 Conectando a MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado a MongoDB');

        // Mostrar estadísticas antes de limpiar
        const total = await Transaction.countDocuments();
        const pending = await Transaction.countDocuments({
            status: { $in: ['pending_verification', 'pending_manual_payout'] }
        });
        const processing = await Transaction.countDocuments({ status: 'processing' });
        const succeeded = await Transaction.countDocuments({ status: 'succeeded' });
        const failed = await Transaction.countDocuments({ status: 'failed' });

        console.log('\n📊 Estado Actual:');
        console.log(`  Total: ${total}`);
        console.log(`  Pendientes: ${pending}`);
        console.log(`  Procesando: ${processing}`);
        console.log(`  Exitosas: ${succeeded}`);
        console.log(`  Fallidas: ${failed}`);

        // Opción 1: Eliminar TODAS las transacciones (usar con cuidado)
        console.log('\n⚠️  OPCIÓN 1: Eliminar TODAS las transacciones');
        console.log('⚠️  OPCIÓN 2: Eliminar solo pendientes/fallidas');
        console.log('⚠️  OPCIÓN 3: Marcar como canceladas (no eliminar)');

        // Cambiar esta variable para elegir la opción
        const OPTION = 1; // 1, 2, o 3

        let result;
        switch (OPTION) {
            case 1:
                // Eliminar TODAS
                console.log('\n🗑️  Eliminando TODAS las transacciones...');
                result = await Transaction.deleteMany({});
                console.log(`✅ ${result.deletedCount} transacciones eliminadas`);
                break;

            case 2:
                // Eliminar solo pendientes y fallidas
                console.log('\n🗑️  Eliminando transacciones pendientes y fallidas...');
                result = await Transaction.deleteMany({
                    status: {
                        $in: ['pending_verification', 'pending_manual_payout', 'failed', 'pending']
                    }
                });
                console.log(`✅ ${result.deletedCount} transacciones eliminadas`);
                console.log(`ℹ️  Las transacciones exitosas (succeeded) se mantienen`);
                break;

            case 3:
                // Marcar como canceladas (no eliminar)
                console.log('\n🔄 Marcando transacciones pendientes como canceladas...');
                result = await Transaction.updateMany(
                    {
                        status: {
                            $in: ['pending_verification', 'pending_manual_payout', 'pending', 'processing']
                        }
                    },
                    {
                        $set: { status: 'cancelled' }
                    }
                );
                console.log(`✅ ${result.modifiedCount} transacciones marcadas como canceladas`);
                break;

            default:
                console.log('❌ Opción inválida');
                break;
        }

        // Mostrar estadísticas después
        const totalAfter = await Transaction.countDocuments();
        console.log(`\n📊 Total después: ${totalAfter}`);

        console.log('\n✅ Script completado');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

// Ejecutar
resetTransactions();
