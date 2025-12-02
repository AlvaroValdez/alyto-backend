// backend/src/models/Transaction.js
// Justificación: almacenar las transacciones iniciadas desde /api/withdrawals
// y actualizarlas cuando llegue un IPN de Vita.

import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  order: { type: String, required: true, unique: true },
  createdBy: { type: String, required: true },
  country: { type: String, required: true },
  currency: { type: String, required: true },
  amount: { type: Number, required: true },
  beneficiary_type: { type: String },
  beneficiary_first_name: { type: String },
  beneficiary_last_name: { type: String },
  company_name: { type: String },
  beneficiary_email: { type: String },
  status: { type: String, enum: ['pending', 'succeeded', 'failed'], default: 'pending' },
  vitaResponse: { type: Object },

  // --- NUEVOS CAMPOS PARA ANCHOR MANUAL (BOLIVIA) ---
  proofOfPayment: { type: String }, // URL del comprobante subido por el usuario (On-Ramp)
  recipientQrImage: { type: String }, // Snapshot del QR del destinatario usado (Off-Ramp)
  manualRate: { type: Number }, // Tasa de cambio usada si fue manual

  ipnEvents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'VitaEvent' }]
}, { timestamps: true });

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction; // Se usa 'export default' en lugar de module.exports