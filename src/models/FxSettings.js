// backend/src/models/FxSettings.js
// Justificación: almacenar la configuración de FX (markup) global
// Fuente: lógica interna AVF (no en Vita), se aplica en /api/fx/quote

const mongoose = require('mongoose');

const fxSettingsSchema = new mongoose.Schema(
  {
    markup: { type: Number, required: true, default: 0.03 }, // ej. 0.03 = 3%
  },
  { timestamps: true }
);

module.exports = mongoose.model('FxSettings', fxSettingsSchema);
