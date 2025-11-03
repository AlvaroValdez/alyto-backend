import nodemailer from 'nodemailer';
// Asumiendo que tienes una variable 'isProd' exportada desde tu config/env.js
// Si no, puedes deducirla directamente de process.env.NODE_ENV
import { isProd } from '../config/env.js'; 

// --- Configuración del Transporter de Nodemailer ---
// Lee las credenciales y configuración del servidor SMTP desde las variables de entorno
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT || '587', 10), // Asegura que el puerto sea un número
  secure: process.env.EMAIL_PORT === '465', // 'secure' es true solo si el puerto es 465 (SSL)
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  // Opcional: Deshabilitar la verificación estricta de TLS en desarrollo si es necesario
  // tls: { rejectUnauthorized: isProd } 
});

/**
 * Función genérica para enviar correos electrónicos.
 * @param {object} options - Opciones del correo.
 * @param {string} options.to - El destinatario del correo.
 * @param {string} options.subject - El asunto del correo.
 * @param {string} options.text - El contenido en texto plano (fallback).
 * @param {string} options.html - El contenido en formato HTML.
 */
export const sendEmail = async (options) => {
  // Define las opciones del correo, incluyendo el remitente desde las variables de entorno
  const mailOptions = {
    from: process.env.EMAIL_FROM, // Ej: '"AVF Remesas" <no-reply@avf.com>'
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  };

  try {
    // Intenta enviar el correo usando el transporter configurado
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email enviado a ${options.to}: ${info.messageId}`);
    // Podrías devolver 'true' o la información del envío si es necesario
    return { success: true, messageId: info.messageId }; 
  } catch (error) {
    console.error(`❌ Error enviando email a ${options.to}:`, error);
    return { success: false, error: error.message }; // Opción 2: Devolver fallo
  }
};

// Podrías añadir aquí funciones específicas como sendVerificationEmail, sendWelcomeEmail, etc.
// export const sendVerificationEmail = async (to, token) => { ... }