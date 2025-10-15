// backend/src/models/FxSettings.js
// Justificación: almacenar la configuración de FX (markup) global
// Fuente: lógica interna AVF (no en Vita), se aplica en /api/fx/quote

import mongoose from 'mongoose';

const fxSettingsSchema = new mongoose.Schema(
  {
    markup: { type: Number, required: true, default: 0.03 }, // ej. 0.03 = 3%
  },
  { timestamps: true }
);

const FxSettings = mongoose.model('FxSettings', fxSettingsSchema);

export default FxSettings;
