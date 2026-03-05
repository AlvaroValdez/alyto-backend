import mongoose from 'mongoose';
import { env } from 'process';
import dotenv from 'dotenv';
dotenv.config();

import Transaction from '../models/Transaction.js';
import TransactionConfig from '../models/TransactionConfig.js';
import Markup from '../models/Markup.js';

async function run() {
    try {
        const mongoUri = process.env.MONGO_URI || 'mongodb+srv://app_user:vlow7LV14FLd0aNE@avf-vita.oh8gqvz.mongodb.net/?retryWrites=true&w=majority&appName=avf-vita';
        await mongoose.connect(mongoUri);
        console.log('Connected to DB');

        const tx = await Transaction.findOne({}).sort({ createdAt: -1 });
        if (!tx) {
            console.log('Transaction not found!');
        } else {
            console.log('--- Transaction ---');
            console.log(JSON.stringify(tx, null, 2));
        }

        const config = await TransactionConfig.findOne({ originCountry: 'BO' });
        console.log('--- BO Config ---');
        console.log(JSON.stringify(config, null, 2));

        const markup = await Markup.findOne({ originCountry: 'BO', destCountry: 'CO' });
        console.log('--- BO -> CO Markup ---');
        console.log(JSON.stringify(markup, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        mongoose.disconnect();
    }
}

run();
