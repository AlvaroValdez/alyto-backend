import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createWithdrawal } from './src/services/vitaService.js';
import Transaction from './src/models/Transaction.js';

dotenv.config();

const ORDER_ID = 'ORD-1768761520631'; // Cambiar por el Order ID que quieras procesar

const executeWithdrawal = async () => {
    try {
        console.log('🔌 Conectando a MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado a MongoDB\n');

        console.log(`🔍 Buscando transacción: ${ORDER_ID}`);
        const transaction = await Transaction.findOne({ order: ORDER_ID });

        if (!transaction) {
            console.error('❌ Transacción no encontrada');
            process.exit(1);
        }

        console.log('✅ Transacción encontrada:');
        console.log(`   - ID: ${transaction._id}`);
        console.log(`   - Status: ${transaction.status}`);
        console.log(`   - Payin Status: ${transaction.payinStatus}`);
        console.log(`   - Payout Status: ${transaction.payoutStatus}`);
        console.log(`   - Vita Payment Order ID: ${transaction.vitaPaymentOrderId}`);
        console.log(`   - Vita Withdrawal ID: ${transaction.vitaWithdrawalId || 'N/A'}\n`);

        // Verificar si ya se ejecutó
        if (transaction.vitaWithdrawalId) {
            console.log('⚠️  Este withdrawal ya fue ejecutado anteriormente');
            console.log(`   Vita Withdrawal ID: ${transaction.vitaWithdrawalId}`);
            process.exit(0);
        }

        // Verificar si tiene payload diferido
        if (!transaction.deferredWithdrawalPayload) {
            console.error('❌ No hay deferredWithdrawalPayload en esta transacción');
            console.log('   Esto puede significar que usó el flujo legacy directo');
            process.exit(1);
        }

        console.log('📦 Deferred Withdrawal Payload:');
        console.log(JSON.stringify(transaction.deferredWithdrawalPayload, null, 2));

        // 🔧 FIX: Si beneficiary_address está vacío, usar la dirección del beneficiario guardado
        if (!transaction.deferredWithdrawalPayload.beneficiary_address ||
            transaction.deferredWithdrawalPayload.beneficiary_address === '') {

            const addressFromBeneficiary = transaction.beneficiary?.beneficiary_address ||
                transaction.beneficiary_address ||
                'cali barrio6'; // Fallback de ejemplo

            console.log(`\n🔧 Corrigiendo beneficiary_address vacío...`);
            console.log(`   Usando: "${addressFromBeneficiary}"`);

            transaction.deferredWithdrawalPayload.beneficiary_address = addressFromBeneficiary;
            await transaction.save();
            console.log('✅ Transacción actualizada con dirección corregida\n');
        }

        console.log('\n⏳ Ejecutando withdrawal en Vita...\n');

        let withdrawalResp;
        try {
            withdrawalResp = await createWithdrawal(transaction.deferredWithdrawalPayload);
        } catch (firstError) {
            const errorData = firstError.response?.data?.error || {};
            const msg = `${errorData?.message || ''} ${errorData?.details?.message || ''}`.toLowerCase();

            if (msg.includes('precio') || msg.includes('price') || msg.includes('caducaron')) {
                console.log('⚠️  Precios expirados. Refrescando precios de Vita...\n');

                // Importar función de refresh
                const { forceRefreshPrices } = await import('./src/services/vitaService.js');
                await forceRefreshPrices();

                console.log('⏳ Esperando 2 segundos...');
                await new Promise(r => setTimeout(r, 2000));

                console.log('🔄 Reintentando withdrawal con precios actualizados...\n');
                withdrawalResp = await createWithdrawal(transaction.deferredWithdrawalPayload);
                console.log('✅ Retry exitoso!\n');
            } else {
                throw firstError;
            }
        }

        const wData = withdrawalResp?.data ?? withdrawalResp;

        console.log('✅ Withdrawal ejecutado exitosamente!');
        console.log('📄 Respuesta de Vita:');
        console.log(JSON.stringify(wData, null, 2));

        const vitaWithdrawalId = wData?.id || wData?.data?.id || null;

        console.log(`\n💾 Actualizando transacción en BD...`);
        transaction.vitaWithdrawalId = vitaWithdrawalId;
        transaction.payinStatus = 'completed';
        transaction.payoutStatus = 'processing';
        transaction.status = 'processing';
        await transaction.save();

        console.log('✅ Transacción actualizada:');
        console.log(`   - Vita Withdrawal ID: ${vitaWithdrawalId}`);
        console.log(`   - Payout Status: ${transaction.payoutStatus}`);
        console.log(`   - Status: ${transaction.status}`);
        console.log('\n🎉 ¡Proceso completado exitosamente!');
        console.log(`   El beneficiario debería recibir ${transaction.deferredWithdrawalPayload.amount} CLP`);
        console.log(`   convertidos a ${transaction.amountsTracking?.destReceiveAmount || 'N/A'} COP`);

    } catch (error) {
        console.error('\n❌ Error ejecutando withdrawal:', error.message);
        if (error.response) {
            console.error('📄 Respuesta de Vita:');
            console.error(JSON.stringify(error.response.data, null, 2));
        }
        console.error('\n🔍 Stack trace:', error.stack);
    } finally {
        await mongoose.disconnect();
        process.exit();
    }
};

executeWithdrawal();
