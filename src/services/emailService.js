import sgMail from '@sendgrid/mail';

// Configura la clave API de SendGrid al iniciar el servicio
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Función genérica para enviar correos electrónicos usando SendGrid.
 * @param {object} options - Opciones del correo.
 * @param {string} options.to - El destinatario.
 * @param {string} options.subject - El asunto.
 * @param {string} options.text - El contenido en texto plano.
 * @param {string} options.html - El contenido en HTML.
 */
export const sendEmail = async (options) => {
  const msg = {
    to: options.to,
    from: process.env.EMAIL_FROM, // Debe ser el email verificado en SendGrid
    subject: options.subject,
    text: options.text,
    html: options.html,
  };

  try {
    await sgMail.send(msg);
    console.log(`✅ Email enviado a ${options.to} vía SendGrid.`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Error enviando email a ${options.to} vía SendGrid:`, error);
    
    // SendGrid puede devolver errores detallados en la respuesta
    if (error.response) {
      console.error(error.response.body.errors);
    }
    
    // Devolvemos un fallo para que la lógica asíncrona en auth.js no se rompa
    return { success: false, error: error.message };
  }
};