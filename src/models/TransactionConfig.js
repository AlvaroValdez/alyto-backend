import mongoose from 'mongoose';

const transactionConfigSchema = new mongoose.Schema({
  originCountry: { type: String, required: true, unique: true, uppercase: true, trim: true },

  kycLimits: {
    level1: { type: Number, default: 450000 },
    level2: { type: Number, default: 4500000 }
  },
  minAmount: { type: Number, default: 5000 },
  fixedFee: { type: Number, default: 0 },
  isEnabled: { type: Boolean, default: true },
  alertMessage: { type: String, default: '' },

  provider: {
    type: String,
    enum: ['vita_wallet', 'internal_manual'],
    default: 'vita_wallet'
  },

  localBankDetails: {
    bankName: { type: String, default: '' },
    accountNumber: { type: String, default: '' },
    accountType: { type: String, default: '' },
    holderName: { type: String, default: '' },
    holderId: { type: String, default: '' }
  },

  depositQrImage: { type: String },

  // --- NUEVO CAMPO: Tasa Manual ---
  // Ej: 135 (1 BOB = 135 CLP) o la conversión que definas
  manualExchangeRate: { type: Number, default: 0 },

  // 💰 Comisiones (para flujos manuales como BOB)
  feeType: { type: String, enum: ['percentage', 'fixed', 'none'], default: 'percentage' },
  feeAmount: { type: Number, default: 0 }, // % o CLP fijo
  feeCurrency: { type: String, default: 'CLP' }

}, { timestamps: true });

const TransactionConfig = mongoose.model('TransactionConfig', transactionConfigSchema);
export default TransactionConfig;