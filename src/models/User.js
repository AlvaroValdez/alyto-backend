import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'El nombre es obligatorio'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'El correo electrónico es obligatorio'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Por favor, introduce un correo válido'],
  },
  password: {
    type: String,
    required: [true, 'La contraseña es obligatoria'],
    minlength: [6, 'La contraseña debe tener al menos 6 caracteres'],
  },
  // Podríamos añadir un campo 'role' ('user', 'admin') en el futuro
}, { timestamps: true });

// Middleware para hashear la contraseña ANTES de guardarla
userSchema.pre('save', async function(next) {
  // Solo hashear si la contraseña ha sido modificada (o es nueva)
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10); // Genera un "salt" para mayor seguridad
    this.password = await bcrypt.hash(this.password, salt); // Hashea la contraseña
    next();
  } catch (error) {
    next(error);
  }
});

// Método para comparar la contraseña ingresada con la hasheada
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);

export default User;