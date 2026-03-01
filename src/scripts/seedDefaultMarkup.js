/**
 * Script para crear un Markup por defecto en la base de datos
 * Ejecutar con: node backend/src/scripts/seedDefaultMarkup.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

// Definir el esquema de Markup inline (para evitar importar modelo)
const markupSchema = new mongoose.Schema({
    originCurrency: { type: String },
    destCountry: { type: String },
    percent: { type: Number, required: true },
    isDefault: { type: Boolean, default: false },
    description: { type: String }
}, { timestamps: true });

const Markup = mongoose.model('Markup', markupSchema);

async function seedDefaultMarkup() {
    try {
        // Conectar a MongoDB
        const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/alyto';
        await mongoose.connect(mongoUri);
        console.log('✅ Conectado a MongoDB');

        // Verificar si ya existe un markup default
        const existing = await Markup.findOne({ isDefault: true });
        if (existing) {
            console.log('⚠️ Ya existe un Markup por defecto:');
            console.log(existing);
            console.log('\n¿Deseas actualizarlo? Edita este script y elimina el return.');
            return;
        }

        // Crear markup por defecto (2% de comisión)
        const defaultMarkup = await Markup.create({
            isDefault: true,
            percent: 2.0,
            description: 'Comisión estándar (2%) para todas las transferencias'
        });

        console.log('✅ Markup por defecto creado:');
        console.log(defaultMarkup);

        // Opcional: Crear markups específicos por corredor
        const specificMarkups = await Markup.insertMany([
            {
                originCurrency: 'CLP',
                destCountry: 'CO',
                percent: 2.5,
                description: 'Chile → Colombia (corredor principal)'
            },
            {
                originCurrency: 'CLP',
                destCountry: 'PE',
                percent: 3.0,
                description: 'Chile → Perú'
            }
        ]);

        console.log(`✅ Creados ${specificMarkups.length} markups específicos`);

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Desconectado de MongoDB');
    }
}

seedDefaultMarkup();
