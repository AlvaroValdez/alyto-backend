
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

import TransactionConfig from '../models/TransactionConfig.js';

async function seedConfig() {
    try {
        console.log('Connecting to Mongo...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected.');

        console.log('Seeding Bolivia Config...');
        const result = await TransactionConfig.findOneAndUpdate(
            { originCountry: 'BO' },
            {
                originCountry: 'BO',
                isEnabled: true,
                provider: 'internal_manual',
                manualExchangeRate: 140, // 1 BOB = 140 CLP
                feeType: 'percent',
                feeAmount: 3.0, // 3%
                minAmount: 10,
                maxAmount: 10000
            },
            { upsert: true, new: true }
        );

        console.log('✅ Configuration Saved:', result);
        process.exit(0);
    } catch (e) {
        console.error('❌ Error seeding:', e);
        process.exit(1);
    }
}

seedConfig();
