import { sendEmail } from './emailService.js';

/**
 * Servicio Centralizado de Notificaciones
 * Maneja la lógica de "qué" enviar y "cuándo", delegando el "cómo" a emailService.
 */

const STYLES = `
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  line-height: 1.6;
  color: #333;
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
  border: 1px solid #eee;
  border-radius: 8px;
`;

const HEADER = `
  <div style="text-align: center; margin-bottom: 30px;">
    <h1 style="color: #007bff; margin: 0;">AVF Remesas</h1>
  </div>
`;

const FOOTER = `
  <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #999; text-align: center;">
    <p>Gracias por confiar en AVF Remesas.</p>
    <p>Este es un correo automático, por favor no respondas a esta dirección.</p>
  </div>
`;

/**
 * Notifica que se ha creado una nueva intención de orden (frontend).
 * @param {object} data - Datos de la orden { orderId, amount, country, email }
 */
export const notifyOrderCreated = async ({ orderId, amount, country, email }) => {
    if (!email) return;

    const html = `
    <div style="${STYLES}">
      ${HEADER}
      <h2>Orden de Pago Creada</h2>
      <p>Hola,</p>
      <p>Hemos recibido tu solicitud de envío de dinero. A continuación los detalles:</p>
      <ul>
        <li><strong>Orden:</strong> #${orderId}</li>
        <li><strong>Monto a Enviar:</strong> ${amount} CLP</li>
        <li><strong>Destino:</strong> ${country}</li>
      </ul>
      <p>Por favor completa el pago para procesar tu envío.</p>
      ${FOOTER}
    </div>
  `;

    await sendEmail({
        to: email,
        subject: `Orden #${orderId} Creada - AVF Remesas`,
        html
    });
};

/**
 * Notifica que el Payin se ha completado exitosamente (Dinero recibido).
 * @param {object} transaction - Objeto transacción de la BD
 */
export const notifyPayinSuccess = async (transaction) => {
    const email = transaction.userEmail || transaction.createdBy?.email;
    if (!email) return;

    const html = `
    <div style="${STYLES}">
      ${HEADER}
      <h2 style="color: #28a745;">¡Pago Recibido!</h2>
      <p>Hola,</p>
      <p>Hemos confirmado la recepción de tu pago para la orden <strong>#${transaction.order}</strong>.</p>
      <p>Estamos procesando el envío al destinatario en este momento.</p>
      <div style="background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Estado:</strong> Procesando Envío</p>
      </div>
      ${FOOTER}
    </div>
  `;

    await sendEmail({
        to: transaction.userEmail,
        subject: `Pago Confirmado - Orden #${transaction.order}`,
        html
    });
};

/**
 * Notifica que el Payout (Envío) se ha realizado exitosamente o está en proceso bancario.
 * @param {object} transaction - Objeto transacción de la BD
 */
export const notifyPayoutSuccess = async (transaction) => {
    const email = transaction.userEmail || transaction.createdBy?.email;
    if (!email) return;

    const html = `
    <div style="${STYLES}">
      ${HEADER}
      <h2 style="color: #28a745;">¡Envío en Camino!</h2>
      <p>Buenas noticias,</p>
      <p>Los fondos de la orden <strong>#${transaction.order}</strong> han sido enviados al destinatario.</p>
      <ul>
        <li><strong>Monto Enviado:</strong> ${transaction.amountSent} ${transaction.currencySent}</li>
        <li><strong>Referencia de Retiro:</strong> ${transaction.vitaWithdrawalId || 'N/A'}</li>
      </ul>
      <p>Dependiendo del banco destino, los fondos pueden tardar unas horas en reflejarse.</p>
      ${FOOTER}
    </div>
  `;

    await sendEmail({
        to: transaction.userEmail,
        subject: `Envío Completado - Orden #${transaction.order}`,
        html
    });
};

/**
 * Notifica que el envío requiere procesamiento manual (Casos Manual Anchor).
 * @param {object} transaction - Objeto transacción de la BD
 */
export const notifyManualPayoutQueued = async (transaction) => {
    const email = transaction.userEmail || transaction.createdBy?.email;
    if (!email) return;

    const html = `
    <div style="${STYLES}">
      ${HEADER}
      <h2 style="color: #ffc107;">Envío en Revisión</h2>
      <p>Hola,</p>
      <p>Tu orden <strong>#${transaction.order}</strong> ha sido recibida y el pago confirmado.</p>
      <p>Debido al destino seleccionado, tu envío está siendo procesado manualmente por nuestro equipo de tesorería para garantizar la mejor tasa de cambio.</p>
      <p>Te notificaremos apenas se complete el depósito.</p>
      ${FOOTER}
    </div>
  `;

    await sendEmail({
        to: transaction.userEmail,
        subject: `Procesando Envío - Orden #${transaction.order}`,
        html
    });
};

/**
 * Notifica que hubo un fallo en el proceso (Payin o Payout).
 * @param {object} transaction - Objeto transacción de la BD
 * @param {string} reason - Razón del fallo
 */
export const notifyTransactionFailed = async (transaction, reason = 'Error desconocido') => {
    const email = transaction.userEmail || transaction.createdBy?.email;
    if (!email) return;

    const html = `
    <div style="${STYLES}">
      ${HEADER}
      <h2 style="color: #dc3545;">Problema con tu Envío</h2>
      <p>Hola,</p>
      <p>Hubo un inconveniente con la orden <strong>#${transaction.order}</strong>.</p>
      <p><strong>Motivo:</strong> ${reason}</p>
      <p>Por favor contacta a soporte si el problema persiste o si ya se descontó el dinero de tu cuenta.</p>
      ${FOOTER}
    </div>
  `;

    await sendEmail({
        to: transaction.userEmail,
        subject: `Error en Orden #${transaction.order} - AVF Remesas`,
        html
    });
};
