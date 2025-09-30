// backend/src/models/VitaEvent.js
// Justificación: guardar todos los eventos IPN de Vita para auditoría
// Fuente: Vita Webhooks (docs V2-HMAC-SHA256)

const mongoose = require('mongoose');

const vitaEventSchema = new mongoose.Schema(
  {
    vitaId: { type: String },          // id del evento Vita (si existe en payload)
    type: { type: String, required: true }, // ej: payment.succeeded
    payload: { type: Object, required: true }, // body completo del IPN
    headers: { type: Object },         // headers Vita (opcional, para debug)
    verified: { type: Boolean, default: false } // true si la firma pasó
  },
  { timestamps: true }
);

module.exports = mongoose.model('VitaEvent', vitaEventSchema);
