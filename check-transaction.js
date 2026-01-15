import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const transactionSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const Transaction = mongoose.model('Transaction', transactionSchema);

async function checkTransaction() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado a MongoDB\n');

        // Buscar la transacción más reciente de Colombia
        const tx = await Transaction.findOne({ country: 'CO' })
            .sort({ createdAt: -1 })
            .lean();

        if (!tx) {
            console.log('❌ No se encontró transacción a Colombia');
            process.exit(0);
        }

        console.log('📊 ANÁLISIS DETALLADO DE TRANSACCIÓN');
        console.log('═══════════════════════════════════════════════\n');

        console.log('🔍 Identificación:');
        console.log(`   Order ID: ${tx.order}`);
        console.log(`   Fecha: ${tx.createdAt}`);
        console.log(`   Destino: ${tx.country}\n`);

        console.log('💰 FLUJO DE DINERO:\n');

        // 1. Lo que pagó el cliente
        console.log('1️⃣  CLIENTE PAGA:');
        console.log(`   Monto: ${tx.amount} CLP`);
        console.log(`   Comisión: ${tx.fee || 0} CLP`);
        console.log(`   TOTAL COBRADO AL CLIENTE: ${(tx.amount || 0) + (tx.fee || 0)} CLP\n`);

        // 2. Tracking detallado
        if (tx.rateTracking) {
            console.log('2️⃣  TASAS DE CAMBIO:');
            console.log(`   Tasa REAL de Vita: ${tx.rateTracking.vitaRate} (1 CLP = ${tx.rateTracking.vitaRate} COP)`);
            console.log(`   Tasa mostrada a Cliente: ${tx.rateTracking.alytoRate} (1 CLP = ${tx.rateTracking.alytoRate} COP)`);
            console.log(`   Spread aplicado: ${tx.rateTracking.spreadPercent}%`);
            console.log(`   Profit (en COP): ${tx.rateTracking.profitDestCurrency} COP\n`);
        }

        if (tx.amountsTracking) {
            console.log('3️⃣  DESGLOSE DE MONTOS:');
            console.log(`   Principal origen: ${tx.amountsTracking.originPrincipal} ${tx.amountsTracking.originCurrency}`);
            console.log(`   Fee origen: ${tx.amountsTracking.originFee} ${tx.amountsTracking.originCurrency}`);
            console.log(`   Total origen: ${tx.amountsTracking.originTotal} ${tx.amountsTracking.originCurrency}\n`);

            console.log(`   Monto bruto destino: ${tx.amountsTracking.destGrossAmount} ${tx.amountsTracking.destCurrency}`);
            console.log(`   Costo fijo Vita: ${tx.amountsTracking.destVitaFixedCost} ${tx.amountsTracking.destCurrency}`);
            console.log(`   CLIENTE RECIBE: ${tx.amountsTracking.destReceiveAmount} ${tx.amountsTracking.destCurrency}\n`);

            console.log(`   💵 Profit Alyto (origen): ${tx.amountsTracking.profitOriginCurrency} CLP`);
            console.log(`   💵 Profit Alyto (destino): ${tx.amountsTracking.profitDestCurrency} COP\n`);
        }

        // 3. Respuesta de Vita
        console.log('4️⃣  BALANCE EN VITA WALLET:');
        if (tx.vitaResponse) {
            console.log(`   Vita Response:`, JSON.stringify(tx.vitaResponse, null, 2));
        }

        console.log('\n═══════════════════════════════════════════════\n');
        console.log('📝 EXPLICACIÓN DEL FLUJO:\n');
        console.log('   Paso 1: Cliente deposita dinero → entrada a tu wallet Vita');
        console.log('   Paso 2: Vita procesa la remesa internacional');
        console.log('   Paso 3: Vita devuelve el BALANCE NETO (después de costos)');
        console.log('   Paso 4: La diferencia entre salida e ingreso es el COSTO de Vita');
        console.log('   Paso 5: Tu GANANCIA está en el SPREAD, no en el balance\n');

        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkTransaction();
