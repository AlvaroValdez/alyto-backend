import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto'; // Importa el módulo crypto de Node.js

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  isEmailVerified: { type: Boolean, default: false },
  emailVerificationToken: String,
  emailVerificationExpires: Date,

  // --- NUEVOS CAMPOS DE KYC (PERFIL) ---
  firstName: { type: String, trim: true }, // Nombre legal
  lastName: { type: String, trim: true },  // Apellido legal
  documentType: { type: String, enum: ['RUT', 'DNI', 'CE', 'PASSPORT'], uppercase: true },
  documentNumber: { type: String, trim: true },
  phoneNumber: { type: String, trim: true },
  address: { type: String, trim: true },
  birthDate: { type: Date },

  // Bandera virtual para saber si completó el perfil
  isProfileComplete: { type: Boolean, default: false }
}, {
  timestamps: true
});

// Middleware para hashear contraseña (sin cambios)
userSchema.pre('save', function(next) {
  if (this.firstName && this.lastName && this.documentNumber && this.phoneNumber && this.address) {
    this.isProfileComplete = true;
  } else {
    this.isProfileComplete = false;
  }
  next();
});

// Método para comparar contraseña (sin cambios)
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// --- NUEVO MÉTODO PARA GENERAR EL TOKEN DE VERIFICACIÓN ---
userSchema.methods.generateEmailVerificationToken = function () {
  // 1. Genera un token aleatorio seguro (será el que se envíe por email)
  const verificationToken = crypto.randomBytes(32).toString('hex');

  // 2. Hashea el token antes de guardarlo en la base de datos por seguridad
  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');

  // 3. Establece la fecha de expiración (ej: 10 minutos desde ahora)
  this.emailVerificationExpires = Date.now() + 10 * 60 * 1000;

  // 4. Devuelve el token original (sin hashear) para enviarlo por email
  return verificationToken;
};

const User = mongoose.model('User', userSchema);

export default User;