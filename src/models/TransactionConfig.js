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
  profitRetention: { type: Boolean, default: false }, // ✅ Si true, enviamos monto destino fijo para retener profit
  profitRetentionPercent: { type: Number, default: 0, min: 0, max: 100 }, // % del principal a retener (ej: 2.0 = 2%)

  // Fintoc Fees Configuration (Estimación Conservadora)
  fintocConfig: {
    ufValue: { type: Number, default: 37500 },     // Valor UF en CLP (actualizar mensualmente)
    tier: { type: Number, default: 1, min: 1, max: 5 }, // Tier de volumen (1-5)
    lastUpdated: { type: Date, default: Date.now } // Control de vigencia
  },
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

  // --- NUEVO CAMPO: Configuraciones por Destino (Override) ---
  destinations: [{
    countryCode: { type: String, required: true }, // Ej: BO
    isEnabled: { type: Boolean, default: true },
    manualExchangeRate: { type: Number, default: 0 }, // Tasa Manual (1 CLP = X Dest)
    feeType: { type: String, enum: ['percentage', 'fixed', 'none'], default: 'none' },
    feeAmount: { type: Number, default: 0 },
    payoutFixedFee: { type: Number, default: 0 }, // Costo fijo del retiro en destino
    _id: false
  }],

  // --- NUEVO CAMPO: Tasa Manual ---
  // Ej: 135 (1 BOB = 135 CLP) o la conversión que definas
  manualExchangeRate: { type: Number, default: 0 },

  // 💰 Comisiones (para flujos manuales como BOB)
  feeType: { type: String, enum: ['percentage', 'fixed', 'none'], default: 'percentage' },
  feeAmount: { type: Number, default: 0 }, // % o CLP fijo
  feeCurrency: { type: String, default: 'CLP' },

  // 💳 Payment Methods Configuration
  paymentMethods: {
    direct: {
      enabled: { type: Boolean, default: true },
      // Filter specific providers (if empty, show all available)
      // e.g., ['webpay', 'fintoc', 'khipu']
      allowedProviders: [{ type: String }]
    },
    redirect: {
      enabled: { type: Boolean, default: true }
    }
  }

}, { timestamps: true });

const TransactionConfig = mongoose.model('TransactionConfig', transactionConfigSchema);
export default TransactionConfig;