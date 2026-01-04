import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

import TransactionConfig from '../models/TransactionConfig.js';

async function checkConfig() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to Mongo');

        const config = await TransactionConfig.findOne({ originCountry: 'BO' });
        console.log('Bolivia Config:', config);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkConfig();
