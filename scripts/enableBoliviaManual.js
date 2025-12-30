import mongoose from 'mongoose';
import dotenv from 'dotenv';
import TransactionConfig from '../src/models/TransactionConfig.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Fix path for dotenv
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected');
    } catch (err) {
        console.error('Error connecting to MongoDB:', err.message);
        process.exit(1);
    }
};

const enableBolivia = async () => {
    await connectDB();

    try {
        const clConfig = await TransactionConfig.findOne({ originCountry: 'CL' });

        if (!clConfig) {
            console.error('No configuration found for CL. Please seed initial config first.');
            process.exit(1);
        }

        // Define Bolivia Manual Config
        const boliviaConfig = {
            countryCode: 'BO',
            isEnabled: true,
            manualExchangeRate: 0.0073, // EXAMPLE RATE: 100,000 CLP -> ~730 BOB
            feeType: 'percentage',
            feeAmount: 1.5, // 1.5% Fee
            payoutFixedFee: 0 // Free payout for now
        };

        // Update or Add
        if (!clConfig.destinations) clConfig.destinations = [];

        const existingIndex = clConfig.destinations.findIndex(d => d.countryCode === 'BO');
        if (existingIndex >= 0) {
            clConfig.destinations[existingIndex] = boliviaConfig;
            console.log('Updated existing Bolivia config.');
        } else {
            clConfig.destinations.push(boliviaConfig);
            console.log('Added new Bolivia config.');
        }

        await clConfig.save();
        console.log('Successfully enabled Manual Anchor for Chile -> Bolivia.');
        console.log('Current Destinations:', JSON.stringify(clConfig.destinations, null, 2));

    } catch (error) {
        console.error('Error updating config:', error);
    } finally {
        mongoose.connection.close();
    }
};

enableBolivia();
