import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const userSchema = new mongoose.Schema({
  // --- DATOS BÁSICOS (Nivel 0/Registro) ---
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  isEmailVerified: { type: Boolean, default: false },
  emailVerificationToken: String,
  emailVerificationExpires: Date,

  // --- DATOS PERSONALES (Nivel 1 - Declarativo) ---
  firstName: { type: String, trim: true },
  lastName: { type: String, trim: true },
  documentType: { type: String, enum: ['RUT', 'DNI', 'CE', 'PASSPORT'], uppercase: true },
  documentNumber: { type: String, trim: true },
  phoneNumber: { type: String, trim: true },
  address: { type: String, trim: true },
  birthDate: { type: Date },

  // --- ESTADO Y DOCUMENTOS DE KYC (Niveles 2 y 3) ---
  kyc: {
    level: { type: Number, default: 1 }, // 1: Básico, 2: Documental, 3: Reforzado
    status: {
      type: String,
      enum: ['unverified', 'pending', 'approved', 'rejected', 'review'],
      default: 'unverified'
    },
    documents: {
      idFront: { type: String }, // URL de la imagen en Cloudinary
      idBack: { type: String },  // URL de la imagen
      selfie: { type: String },  // URL de la imagen
      proofOfAddress: { type: String } // URL de la imagen (Nivel 3)
    },
    rejectionReason: { type: String }, // Mensaje para el usuario si falla
    submittedAt: { type: Date }, // Fecha de envío de documentos
    verifiedAt: { type: Date }   // Fecha de aprobación
  },

  // Bandera virtual para compatibilidad con lógica anterior
  isProfileComplete: { type: Boolean, default: false }
}, {
  timestamps: true
});

// Middleware pre-save
userSchema.pre('save', async function(next) {
  // Hash de contraseña
  if (this.isModified('password')) {
    try {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
    } catch (error) {
      return next(error);
    }
  }

  // Lógica automática Nivel 1: Si tiene datos básicos, es Nivel 1
  const hasBasicData = this.firstName && this.lastName && this.documentNumber && this.phoneNumber && this.address;
  
  if (hasBasicData) {
    this.isProfileComplete = true;
    // Si estaba en nivel 0, lo subimos a 1 automáticamente
    if (this.kyc.level < 1) {
        this.kyc.level = 1;
        this.kyc.status = 'approved'; // El nivel 1 es automático
    }
  } else {
    this.isProfileComplete = false;
  }

  next();
});

// Métodos existentes (sin cambios)
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.generateEmailVerificationToken = function() {
  const verificationToken = crypto.randomBytes(32).toString('hex');
  this.emailVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
  this.emailVerificationExpires = Date.now() + 10 * 60 * 1000;
  return verificationToken;
};

const User = mongoose.model('User', userSchema);
export default User;