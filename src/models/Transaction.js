// backend/src/models/Transaction.js
// Justificación: almacenar las transacciones iniciadas desde /api/withdrawals
// y actualizarlas cuando llegue un IPN de Vita.

const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    order: { type: String, required: true, unique: true }, // mismo "order" que mandamos a Vita
    country: { type: String, required: true },
    currency: { type: String, required: true },
    amount: { type: Number, required: true },
    beneficiary_type: { type: String },
    beneficiary_first_name: { type: String },
    beneficiary_last_name: { type: String },
    company_name: { type: String },
    beneficiary_email: { type: String },
    status: {
      type: String,
      enum: ['pending', 'succeeded', 'failed'],
      default: 'pending',
    },
    vitaResponse: { type: Object }, // payload devuelto por Vita al crear withdrawal
    ipnEvents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'VitaEvent' }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Transaction', transactionSchema);
