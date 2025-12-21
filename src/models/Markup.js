// backend/src/models/Markup.js
import { Schema, model } from 'mongoose';

const PairSchema = new Schema({
  originCurrency: { type: String, required: true }, // ej: CLP
  destCountry: { type: String, required: true },    // ej: CO
  percent: { type: Number, required: true },        // ej: 3 => 3%
}, { _id: false });

const MarkupSchema = new Schema({
  defaultPercent: { type: Number, default: 0 },
  pairs: { type: [PairSchema], default: [] },
}, { timestamps: true });

const Markup = model('Markup', MarkupSchema);

export default Markup;