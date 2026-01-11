import { Resend } from 'resend';

// Inicializar Resend con API key
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Función genérica para enviar correos electrónicos usando Resend.
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

/**
 * Template para email de verificación con logo de Alyto
 */
export const getVerificationEmailTemplate = (verificationUrl, userName) => {
  // Debug log para verificar URL
  console.log('🔗 [Email] Verification URL:', verificationUrl);

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verificación de Email - Alyto</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Arial', sans-serif; background-color: #f4f4f4;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f4f4f4;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <!-- Container -->
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header with Logo -->
          <tr>
            <td style="padding: 40px 40px 30px; text-align: center; background: linear-gradient(135deg, #233E58 0%, #20c997 100%); border-radius: 8px 8px 0 0;">
              <img src="https://res.cloudinary.com/dq6fmcodk/image/upload/v1737406652/alyto-logo-white.png" alt="Alyto" style="height: 50px; margin-bottom: 15px;" />
              <p style="margin: 10px 0 0; color: #ffffff; font-size: 14px; opacity: 0.9;">Remesas Internacionales</p>
            </td>
          </tr>
          
          <!-- Body -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 20px; color: #333333; font-size: 24px; font-weight: bold;">¡Bienvenido${userName ? ', ' + userName : ''}!</h2>
              
              <p style="margin: 0 0 20px; color: #666666; font-size: 16px; line-height: 1.6;">
                Gracias por registrarte en Alyto. Estamos emocionados de tenerte con nosotros.
              </p>
              
              <p style="margin: 0 0 30px; color: #666666; font-size: 16px; line-height: 1.6;">
                Para completar tu registro y comenzar a enviar dinero de forma segura, por favor verifica tu correo electrónico haciendo clic en el botón de abajo:
              </p>
              
              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 0 0 30px;">
                    <a href="${verificationUrl}" style="display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #233E58 0%, #20c997 100%); color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                      Verificar Mi Correo
                    </a>
                  </td>
                </tr>
              </table>
              
              <!-- Alternative Link -->
              <p style="margin: 0 0 20px; color: #999999; font-size: 14px; line-height: 1.6;">
                Si el botón no funciona, copia y pega este enlace en tu navegador:
              </p>
              <p style="margin: 0 0 30px; padding: 15px; background-color: #f8f8f8; border-radius: 4px; color: #666666; font-size: 12px; word-break: break-all; border-left: 3px solid #20c997;">
                ${verificationUrl}
              </p>
              
              <!-- Warning -->
              <div style="padding: 15px; background-color: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px; margin-bottom: 20px;">
                <p style="margin: 0; color: #856404; font-size: 14px;">
                  <strong>⚠️ Importante:</strong> Este enlace expirará en 10 minutos por seguridad.
                </p>
              </div>
              
              <p style="margin: 0; color: #999999; font-size: 14px; line-height: 1.6;">
                Si no creaste una cuenta en Alyto, puedes ignorar este correo de forma segura.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #f8f8f8; border-radius: 0 0 8px 8px; text-align: center;">
              <p style="margin: 0 0 10px; color: #999999; font-size: 14px;">
                © 2026 Alyto. Todos los derechos reservados.
              </p>
              <p style="margin: 0; color: #999999; font-size: 12px;">
                Remesas internacionales seguras y confiables
              </p>
              <p style="margin: 15px 0 0; color: #999999; font-size: 12px;">
                <a href="https://alyto.app" style="color: #20c997; text-decoration: none;">Visitar sitio web</a> • 
                <a href="https://alyto.app/ayuda" style="color: #20c997; text-decoration: none;">Ayuda</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
};

// No hay conexión que verificar con Resend, funciona por API
console.log('✅ [Email Service] Resend configurado y listo');