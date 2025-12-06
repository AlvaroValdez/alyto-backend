import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  order: { type: String, required: true, unique: true },
  country: { type: String, required: true },
  currency: { type: String, required: true },
  amount: { type: Number, required: true },

  beneficiary_type: { type: String },
  beneficiary_first_name: { type: String },
  beneficiary_last_name: { type: String },
  company_name: { type: String },
  beneficiary_email: { type: String },

  // --- CORRECCIÓN: Añadir nuevos estados al enum ---
  status: {
    type: String,
    enum: [
      'pending',                 // Pendiente estándar
      'pending_verification',    // Esperando confirmación de depósito (On-Ramp Manual)
      'pending_manual_payout',   // Esperando envío manual (Off-Ramp Manual)
      'processing',              // En proceso
      'succeeded',               // Completado
      'failed'                   // Fallido
    ],
    default: 'pending'
  },

  vitaResponse: { type: Object },

  // Referencia al usuario que creó la transacción
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Campos para operaciones manuales
  proofOfPayment: { type: String }, // URL del comprobante
  manualRate: { type: Number },     // Tasa manual usada

  ipnEvents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'VitaEvent' }]
}, { timestamps: true });

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;