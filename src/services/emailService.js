import { Resend } from 'resend';

// Inicializar Resend con API key
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Función genérica para enviar correos electrónicos usando Resend.
 * Resend funciona perfectamente en Render y permite usar dominio personalizado.
 * @param {object} options - Opciones del correo.
 * @param {string} options.to - El destinatario.
 * @param {string} options.subject - El asunto.
 * @param {string} options.text - El contenido en texto plano (opcional).
 * @param {string} options.html - El contenido en HTML.
 */
export const sendEmail = async (options) => {
  try {
    const { data, error } = await resend.emails.send({
      from: `Alyto Remesas <${process.env.EMAIL_FROM || 'noreply@alyto.app'}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (error) {
      console.error(`❌ Error enviando email a ${options.to}:`, error);
      return { success: false, error: error.message };
    }

    console.log(`✅ Email enviado exitosamente a ${options.to}`);
    console.log(`   Message ID: ${data.id}`);
    return { success: true, messageId: data.id };
  } catch (error) {
    console.error(`❌ Error enviando email a ${options.to}:`, error);
    return { success: false, error: error.message };
  }
};

// No hay conexión que verificar con Resend, funciona por API
console.log('✅ [Email Service] Resend configurado y listo');