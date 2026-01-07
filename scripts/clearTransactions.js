import mongoose from 'mongoose';

const MONGO_URI = 'mongodb+srv://avfremesas:02HMxQz8jC3QMLSH@cluster0.vkpqf.mongodb.net/avf-remesas?retryWrites=true&w=majority';

async function clearTransactions() {
    try {
        console.log('🔌 Conectando a MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Conectado');

        const db = mongoose.connection.db;
        const result = await db.collection('withdrawals').deleteMany({});

        console.log(`🗑️  ${result.deletedCount} transacciones eliminadas`);

        await mongoose.disconnect();
        console.log('✅ Desconectado');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

clearTransactions();
