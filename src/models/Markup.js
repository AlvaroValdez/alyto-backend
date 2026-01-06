// backend/src/models/Markup.js
import { Schema, model } from 'mongoose';

const MarkupSchema = new Schema({
  // País origen (opcional - si no está definido, aplica a todos)
  originCountry: { type: String }, // ej: 'CL'

  // País destino (opcional - si no está definido, es el default para el origen)
  destCountry: { type: String },   // ej: 'CO'

  // Porcentaje de spread/markup
  percent: { type: Number, required: true }, // ej: 2.5 => 2.5%

  // Indica si es el markup global por defecto
  isDefault: { type: Boolean, default: false },

  // Descripción opcional
  description: { type: String }
}, { timestamps: true });

// Índices para búsqueda eficiente
MarkupSchema.index({ originCountry: 1, destCountry: 1 });
MarkupSchema.index({ isDefault: 1 });

const Markup = model('Markup', MarkupSchema);

export default Markup;
