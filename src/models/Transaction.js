import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  order: { type: String, required: true, unique: true },
  country: { type: String, required: true },
  currency: { type: String, required: true },
  amount: { type: Number, required: true },

  // Datos del Beneficiario (Básicos)
  beneficiary_type: { type: String },
  beneficiary_first_name: { type: String },
  beneficiary_last_name: { type: String },
  company_name: { type: String },
  beneficiary_email: { type: String },

  // --- NUEVOS CAMPOS BANCARIOS (Detalles para Transferir) ---
  beneficiary_document_type: { type: String },   // RUT, DNI, CI
  beneficiary_document_number: { type: String }, // El número de documento
  bank_code: { type: String },                   // Codigo del Banco
  bank_name: { type: String },                   // Nombre del Banco
  account_type_bank: { type: String },           // Ahorro / Corriente
  account_bank: { type: String },                // Número de Cuenta

  status: {
    type: String,
    enum: [
      'pending', 'pending_verification', 'pending_manual_payout',
      'processing', 'succeeded', 'failed'
    ],
    default: 'pending'
  },

  vitaResponse: { type: Object },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Operaciones manuales
  proofOfPayment: { type: String },
  recipientQrImage: { type: String }, // QR del destinatario
  manualRate: { type: Number },

}, { timestamps: true });

const Transaction = mongoose.model('Transaction', transactionSchema);
export default Transaction;