// backend/src/models/Markup.js
const { Schema, model } = require('mongoose');

const PairSchema = new Schema({
  originCurrency: { type: String, required: true }, // e.g., CLP
  destCountry: { type: String, required: true },    // e.g., CO
  percent: { type: Number, required: true },        // e.g., 3 => 3%
}, { _id: false });

const MarkupSchema = new Schema({
  defaultPercent: { type: Number, default: 0 },
  pairs: { type: [PairSchema], default: [] },
}, { timestamps: true });

module.exports = model('Markup', MarkupSchema);
