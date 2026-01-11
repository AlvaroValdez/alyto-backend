import nodemailer from 'nodemailer';

// Configurar transporter de Nodemailer con GoDaddy SMTP
const transporter = nodemailer.createTransport({
  host: 'smtpout.secureserver.net',
  port: 465,
  secure: true, // true para puerto 465, false para otros puertos
  auth: {
    user: process.env.EMAIL_FROM, // noreply@alyto.app
    pass: process.env.EMAIL_PASSWORD // Contraseña del email en GoDaddy
  }
});

/**
 * Función genérica para enviar correos electrónicos usando Nodemailer + GoDaddy SMTP.
 * @param {object} options - Opciones del correo.
 * @param {string} options.to - El destinatario.
 * @param {string} options.subject - El asunto.
 * @param {string} options.text - El contenido en texto plano.
 * @param {string} options.html - El contenido en HTML.
 */
export const sendEmail = async (options) => {
  const mailOptions = {
    from: `"Alyto Remesas" <${process.env.EMAIL_FROM}>`, // Nombre + Email
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email enviado exitosamente a ${options.to}`);
    console.log(`   Message ID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`❌ Error enviando email a ${options.to}:`, error);

    // Log más detallado del error
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    if (error.response) {
      console.error(`   SMTP response: ${error.response}`);
    }

    return { success: false, error: error.message };
  }
};

// Verificar conexión SMTP al iniciar (opcional, útil para debugging)
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ [Email Service] Error conectando a GoDaddy SMTP:', error);
  } else {
    console.log('✅ [Email Service] Conexión SMTP con GoDaddy lista');
  }
});