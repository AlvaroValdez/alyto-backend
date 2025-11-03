import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto'; // Importa el módulo crypto de Node.js

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'El nombre es obligatorio.'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'El correo electrónico es obligatorio.'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Por favor, introduce un correo válido.'],
  },
  password: {
    type: String,
    required: [true, 'La contraseña es obligatoria.'],
    minlength: [6, 'La contraseña debe tener al menos 6 caracteres.'],
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
  },
  // --- NUEVOS CAMPOS PARA VERIFICACIÓN DE EMAIL ---
  isEmailVerified: {
    type: Boolean,
    default: false, // Por defecto, el email no está verificado
  },
  emailVerificationToken: String, // Almacenará el hash del token
  emailVerificationExpires: Date, // Almacenará la fecha de expiración del token
}, { 
  timestamps: true 
});

// Middleware para hashear contraseña (sin cambios)
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Método para comparar contraseña (sin cambios)
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// --- NUEVO MÉTODO PARA GENERAR EL TOKEN DE VERIFICACIÓN ---
userSchema.methods.generateEmailVerificationToken = function() {
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