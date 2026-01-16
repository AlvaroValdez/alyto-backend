import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { getPaymentOrder } from './src/services/vitaService.js';
import Transaction from './src/models/Transaction.js';

dotenv.config();

const ORDER_ID = 'ORD-1768590645975';

const run = async () => {
    try {
        console.log('--- Connecting to DB ---');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected.');

        console.log(`\n--- Searching Local DB for ${ORDER_ID} ---`);
        const localTx = await Transaction.findOne({ order: ORDER_ID });
        console.log('Local Transaction:', localTx ? JSON.stringify(localTx, null, 2) : 'NOT FOUND');

        console.log(`\n--- Fetching from VITA API for ${ORDER_ID} ---`);
        try {
            const vitaOrder = await getPaymentOrder(ORDER_ID);
            console.log('Vita Order Details:', JSON.stringify(vitaOrder, null, 2));
        } catch (e) {
            console.error('Error fetching from Vita:', e.message);
            if (e.response) console.error('Response data:', e.response.data);
        }

    } catch (error) {
        console.error('Script Error:', error);
    } finally {
        await mongoose.disconnect();
        process.exit();
    }
};

run();
