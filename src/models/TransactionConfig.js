import mongoose from 'mongoose';

const transactionConfigSchema = new mongoose.Schema({
  // País de origen al que aplican estas reglas (ej: 'CL')
  originCountry: { 
    type: String, 
    required: true, 
    unique: true, 
    uppercase: true, 
    trim: true 
  },
  
  // --- 1. Límites KYC Variables ---
  kycLimits: {
    level1: { type: Number, default: 450000 },  // Límite para usuarios básicos
    level2: { type: Number, default: 4500000 }  // Límite para usuarios verificados
  },

  // --- 2. Monto Mínimo ---
  minAmount: { type: Number, default: 5000 }, // Nadie puede enviar menos de esto

  // --- 3. Fee Fijo ---
  fixedFee: { type: Number, default: 0 }, // Costo extra fijo por transacción (opcional)

  // --- 4. Kill Switch (Interruptor) ---
  isEnabled: { type: Boolean, default: true }, // Si es false, nadie puede enviar desde este país

  // --- 5. Mensajes Globales ---
  alertMessage: { type: String, default: '' } // Mensaje visible en el formulario (ej: "Demoras por feriado")

}, { timestamps: true });

const TransactionConfig = mongoose.model('TransactionConfig', transactionConfigSchema);
export default TransactionConfig;