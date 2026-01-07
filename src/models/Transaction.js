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
      'failed',
      'rejected'
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

  // ❌ Rejection tracking
  rejectionReason: { type: String },
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectedAt: { type: Date },

  // 💳 Payment method tracking
  paymentMethod: {
    type: String,
    enum: ['direct_pay', 'webpay', 'manual_anchor', 'other'],
    default: 'other'
  },

  // 💰 Financial Tracking (Spread Model)
  rateTracking: {
    vitaRate: { type: Number },           // Tasa real de Vita
    alytoRate: { type: Number },          // Tasa mostrada al cliente (con spread)
    spreadPercent: { type: Number },      // % de spread aplicado
    profitDestCurrency: { type: Number }  // Ganancia en moneda destino
  },

  // 📊 Amounts Tracking (Real amounts per currency)
  amountsTracking: {
    // Origen
    originCurrency: { type: String },
    originPrincipal: { type: Number },     // Monto base (sin fee)
    originFee: { type: Number },           // 0 en spread model
    originTotal: { type: Number },         // Total cobrado

    // Destino
    destCurrency: { type: String },
    destGrossAmount: { type: Number },     // Antes de costos Vita
    destVitaFixedCost: { type: Number },   // Costo fijo Vita
    destReceiveAmount: { type: Number },   // Lo que recibe cliente

    // Profit
    profitOriginCurrency: { type: Number },
    profitDestCurrency: { type: Number }
  },

  // 🔍 Fee Audit
  feeAudit: {
    markupSource: { type: String, enum: ['default', 'country-specific', 'manual'] },
    markupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Markup' },
    appliedAt: { type: Date }
  },

  // 💰 Comisiones
  fee: { type: Number, default: 0 }, // Comisión en CLP
  feePercent: { type: Number, default: 0 }, // Porcentaje aplicado
  feeOriginAmount: { type: Number, default: 0 }, // Comisión en moneda origen

  // 🔄 IDs de Vita para flujo Payin → Payout
  vitaPaymentOrderId: { type: String }, // ID del Payment Order (Payin)
  vitaWithdrawalId: { type: String },   // ID del Withdrawal (Payout)

  // 📊 Estados separados para Payin y Payout
  payinStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'expired'],
    default: 'pending'
  },
  payoutStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },

  // 📦 Metadata del Payment Order (datos del beneficiario, etc.)
  metadata: { type: Object },

  // ❌ Mensaje de error si algo falla
  errorMessage: { type: String },

  ipnEvents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'VitaEvent' }],

  // Campos adicionales para propósito de transacción
  purpose: { type: String },
  purpose_comentary: { type: String }

}, { timestamps: true });

// Índices útiles
transactionSchema.index({ createdBy: 1, createdAt: -1 });
transactionSchema.index({ status: 1, createdAt: -1 });
transactionSchema.index({ vitaPaymentOrderId: 1 });
transactionSchema.index({ vitaWithdrawalId: 1 });
transactionSchema.index({ payinStatus: 1, payoutStatus: 1 });

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;
