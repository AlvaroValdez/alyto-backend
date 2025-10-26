import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Definición del esquema del usuario
const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'El nombre es obligatorio.'], // Campo requerido con mensaje de error
    trim: true, // Elimina espacios en blanco al inicio y final
  },
  email: {
    type: String,
    required: [true, 'El correo electrónico es obligatorio.'],
    unique: true, // Asegura que no haya emails duplicados
    lowercase: true, // Guarda el email siempre en minúsculas
    trim: true,
    // Validación básica de formato de email
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Por favor, introduce un correo válido.'],
  },
  password: {
    type: String,
    required: [true, 'La contraseña es obligatoria.'],
    minlength: [6, 'La contraseña debe tener al menos 6 caracteres.'], // Longitud mínima
  },
  role: {
    type: String,
    enum: ['user', 'admin'], // Solo permite estos dos valores
    default: 'user', // Asigna 'user' por defecto si no se especifica
  },
}, { 
  timestamps: true // Añade automáticamente campos createdAt y updatedAt
});

// Middleware (hook) que se ejecuta ANTES de guardar un usuario en la BD
userSchema.pre('save', async function(next) {
  // Si la contraseña no ha sido modificada (ej: al actualizar el nombre), no hace nada
  if (!this.isModified('password')) {
    return next();
  }

  // Si la contraseña es nueva o se modificó, la hashea
  try {
    const salt = await bcrypt.genSalt(10); // Genera un "salt" aleatorio
    this.password = await bcrypt.hash(this.password, salt); // Hashea la contraseña con el salt
    next(); // Continúa con el proceso de guardado
  } catch (error) {
    next(error); // Si hay un error, lo pasa al manejador de errores
  }
});

// Método personalizado para comparar la contraseña ingresada con la guardada (hasheada)
userSchema.methods.comparePassword = async function(candidatePassword) {
  // Compara la contraseña candidata con el hash almacenado en this.password
  return await bcrypt.compare(candidatePassword, this.password);
};

// Crea el modelo a partir del esquema
const User = mongoose.model('User', userSchema);

// Exporta el modelo para que pueda ser usado en otros archivos (ej: en las rutas de autenticación)
export default User;