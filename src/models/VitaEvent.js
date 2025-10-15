// backend/src/models/VitaEvent.js
// Justificación: guardar todos los eventos IPN de Vita para auditoría
// Fuente: Vita Webhooks (docs V2-HMAC-SHA256)

import mongoose from 'mongoose';

const vitaEventSchema = new mongoose.Schema({
  vitaId: { type: String },
  type: { type: String, required: true },
  payload: { type: Object },
  headers: { type: Object },
  verified: { type: Boolean, default: false }
}, { timestamps: true });

const VitaEvent = mongoose.model('VitaEvent', vitaEventSchema);

export default VitaEvent;
