// backend/src/models/Transaction.js
import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  order: { type: String, required: true, unique: true },

  country: { type: String, required: true },   // destino (ej: CO)
  currency: { type: String, required: true },  // moneda origen (ej: CLP/BOB)
  amount: { type: Number, required: true },

  beneficiary_type: { type: String },
  beneficiary_first_name: { type: String },
  beneficiary_last_name: { type: String },
  company_name: { type: String },
  beneficiary_email: { type: String },

  status: {
    type: String,
    enum: [
      'pending',
      'pending_verification',
      'pending_manual_payout',
      'processing',
      'succeeded',
      'failed'
    ],
    default: 'pending'
  },

  // Respuesta cruda de Vita (si aplica)
  vitaResponse: { type: Object },

  // ✅ Payload completo (auditoría / reconstrucción interna)
  // Contiene beneficiary + bank + fc_* + etc.
  withdrawalPayload: { type: Object },

  // ✅ Payload exacto que se envió (o se enviará) a Vita (filtrado por rules)
  // CLAVE para:
  // - evitar errores de firma
  // - ejecutar "Aprobar depósito" en Tesorería sin recomputar
  vitaPayload: { type: Object },

  // Auditoría (opcional, pero súper útil)
  approvedDepositBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedDepositAt: { type: Date },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  proofOfPayment: { type: String },
  manualRate: { type: Number },

  // 💰 Comisiones
  fee: { type: Number, default: 0 }, // Comisión en CLP
  feePercent: { type: Number, default: 0 }, // Porcentaje aplicado
  feeOriginAmount: { type: Number, default: 0 }, // Comisión en moneda origen

  ipnEvents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'VitaEvent' }]
}, { timestamps: true });

// Índices útiles
transactionSchema.index({ createdBy: 1, createdAt: -1 });
transactionSchema.index({ status: 1, createdAt: -1 });

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;
