import mongoose from 'mongoose';

const beneficiarySchema = new mongoose.Schema({
  // Vínculo con el usuario que lo creó
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // Apodo amigable para el frontend
  nickname: {
    type: String,
    required: [true, 'El apodo es obligatorio.'],
    trim: true,
  },
  // País de destino (para filtrar)
  country: {
    type: String,
    required: true,
  },
  // Objeto flexible para guardar todos los campos dinámicos
  // (ej: beneficiary_first_name, bank_code, account_bank, etc.)
  beneficiaryData: {
    type: Map,
    of: String,
    required: true,
  },
}, {
  timestamps: true // Añade createdAt y updatedAt
});

// Índice para asegurar que un usuario no tenga apodos duplicados (opcional)
beneficiarySchema.index({ user: 1, nickname: 1 }, { unique: true });

const Beneficiary = mongoose.model('Beneficiary', beneficiarySchema);

export default Beneficiary;