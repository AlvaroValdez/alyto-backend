// test-receipt-generation.js
/**
 * Script de prueba para generación de comprobantes
 * 
 * Uso:
 *   node test-receipt-generation.js
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import receiptService from './src/services/receipt/receiptService.js';
import Transaction from './src/models/Transaction.js';
import User from './src/models/User.js';

dotenv.config();

async function testReceiptGeneration() {
    try {
        console.log('🧪 Iniciando prueba de generación de comprobantes...\n');

        // 1. Conectar a MongoDB
        console.log('📡 Conectando a MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado a MongoDB\n');

        // 2. Buscar una transacción de prueba
        console.log('🔍 Buscando transacción de prueba...');
        const transaction = await Transaction.findOne({
            status: 'succeeded'
        }).populate('createdBy');

        if (!transaction) {
            console.log('❌ No se encontró ninguna transacción exitosa en la base de datos');
            console.log('💡 Tip: Crea primero una transacción de prueba o usa una existente');
            process.exit(1);
        }

        console.log(`✅ Transacción encontrada: ${transaction.order}`);
        console.log(`   Cliente: ${transaction.createdBy.name}`);
        console.log(`   Monto: ${transaction.amount} ${transaction.currency}\n`);

        // 3. Generar comprobante
        console.log('📄 Generando comprobante...');
        const receipt = await receiptService.generateReceipt(
            transaction._id.toString(),
            transaction.createdBy._id.toString()
        );

        console.log('\n✅ ¡Comprobante generado exitosamente!\n');
        console.log('📋 Detalles del comprobante:');
        console.log('─────────────────────────────────────────────────');
        console.log(`   Número: ${receipt.receiptNumber}`);
        console.log(`   Cliente: ${receipt.client.legalName}`);
        console.log(`   NIT: ${receipt.client.nit}`);
        console.log(`   Email: ${receipt.client.email}`);
        console.log(`   Monto Total: Bs. ${receipt.amount.total.toFixed(2)}`);
        console.log(`   Fee: ${receipt.amount.feePercentage}%`);
        console.log(`   Hash TX: ${receipt.transaction.txHash}`);
        console.log(`   URL de Verificación: ${receipt.verification.url}`);
        console.log(`   PDF guardado: ${receipt.pdfBuffer ? 'Sí (' + receipt.pdfBuffer.length + ' bytes)' : 'No'}`);
        console.log('─────────────────────────────────────────────────\n');

        // 4. Guardar PDF de prueba (opcional)
        const fs = await import('fs/promises');
        const outputPath = `./comprobante-${receipt.receiptNumber}.pdf`;
        await fs.writeFile(outputPath, receipt.pdfBuffer);
        console.log(`💾 PDF guardado en: ${outputPath}\n`);

        // 5. Verificar que se puede recuperar
        console.log('🔍 Verificando que el comprobante se puede recuperar...');
        const retrieved = await receiptService.getReceiptWithPDF(receipt.receiptNumber);
        console.log(`✅ Comprobante recuperado correctamente\n`);

        console.log('🎉 ¡Prueba completada exitosamente!');

    } catch (error) {
        console.error('\n❌ Error durante la prueba:', error);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log('\n📡 Desconectado de MongoDB');
    }
}

// Ejecutar prueba
testReceiptGeneration();
