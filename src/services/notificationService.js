import { sendEmail } from './emailService.js';
import { sendPushNotification, notifyUser, notifyAdmins } from './fcmService.js';

/**
 * Servicio Centralizado de Notificaciones
 * Envía email + push en paralelo (fire-and-forget para push)
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
    <h1 style="color: #007bff; margin: 0;">Alyto</h1>
  </div>
`;

const FOOTER = `
  <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #999; text-align: center;">
    <p>Gracias por confiar en Alyto.</p>
    <p>Este es un correo automático, por favor no respondas a esta dirección.</p>
  </div>
`;

// Helper: disparo push sin bloquear
const pushSilent = (promise) => {
  promise?.catch(err => console.error('[Notify] Push error:', err.message));
};

// ─────────────────────────────────────────────
// U1 — Orden creada (email + push usuario)
// ─────────────────────────────────────────────
export const notifyOrderCreated = async ({ orderId, amount, country, email, userId }) => {
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

  await sendEmail({ to: email, subject: `Orden #${orderId} Creada - Alyto`, html });

  if (userId) pushSilent(notifyUser(userId, {
    title: '💸 Envío iniciado',
    body: `Tu orden #${orderId} fue creada. Completa el pago para continuar.`,
    data: { type: 'order_created', orderId }
  }));
};

// ─────────────────────────────────────────────
// U2/U3 — Payin exitoso (Fintoc o Vita)
// ─────────────────────────────────────────────
export const notifyPayinSuccess = async (transaction) => {
  const email = transaction.userEmail || transaction.createdBy?.email;
  const userId = transaction.createdBy?._id || transaction.createdBy;
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

  await sendEmail({ to: email, subject: `Pago Confirmado - Orden #${transaction.order}`, html });

  if (userId) pushSilent(notifyUser(userId, {
    title: '✅ Pago recibido',
    body: `Recibimos tu pago. Procesando envío de la orden #${transaction.order}.`,
    data: { type: 'payin_success', orderId: transaction.order }
  }));
};

// ─────────────────────────────────────────────
// U4 — Withdrawal en proceso (payout iniciado)
// ─────────────────────────────────────────────
export const notifyPayoutProcessing = async (transaction) => {
  const userId = transaction.createdBy?._id || transaction.createdBy;
  if (!userId) return;

  pushSilent(notifyUser(userId, {
    title: '🚀 Enviando dinero',
    body: `Tu envío de la orden #${transaction.order} está en camino.`,
    data: { type: 'payout_processing', orderId: transaction.order }
  }));
};

// ─────────────────────────────────────────────
// U5 — Envío completado automático (Vita)
// ─────────────────────────────────────────────
export const notifyPayoutSuccess = async (transaction) => {
  const email = transaction.userEmail || transaction.createdBy?.email;
  const userId = transaction.createdBy?._id || transaction.createdBy;
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

  await sendEmail({ to: email, subject: `Envío Completado - Orden #${transaction.order}`, html });

  if (userId) pushSilent(notifyUser(userId, {
    title: '🎉 ¡Envío completado!',
    body: `Tu beneficiario recibió el dinero de la orden #${transaction.order}.`,
    data: { type: 'payout_success', orderId: transaction.order }
  }));
};

// ─────────────────────────────────────────────
// U6 — Payout manual Bolivia completado por admin
// ─────────────────────────────────────────────
export const notifyManualPayoutCompleted = async (transaction) => {
  const email = transaction.userEmail || transaction.createdBy?.email;
  const userId = transaction.createdBy?._id || transaction.createdBy;

  if (email) {
    const html = `
        <div style="${STYLES}">
          ${HEADER}
          <h2 style="color: #28a745;">🎉 Transferencia Enviada</h2>
          <p>Tu envío a Bolivia para la orden <strong>#${transaction.order}</strong> fue procesado exitosamente.</p>
          <p>Puedes ver el comprobante bancario en el detalle de tu transacción.</p>
          ${FOOTER}
        </div>
        `;
    await sendEmail({ to: email, subject: `Transferencia a Bolivia Completada - Orden #${transaction.order}`, html }).catch(() => { });
  }

  if (userId) pushSilent(notifyUser(userId, {
    title: '🎉 Transferencia enviada',
    body: `Tu envío a Bolivia fue completado. Revisa el comprobante bancario.`,
    data: { type: 'manual_payout_complete', orderId: transaction.order }
  }));
};

// ─────────────────────────────────────────────
// U7 — Comprobante disponible
// ─────────────────────────────────────────────
export const notifyProofUploaded = async (transaction) => {
  const userId = transaction.createdBy?._id || transaction.createdBy;
  if (!userId) return;

  pushSilent(notifyUser(userId, {
    title: '📄 Comprobante listo',
    body: `Ya puedes ver el comprobante de tu transferencia #${transaction.order}.`,
    data: { type: 'proof_uploaded', orderId: transaction.order }
  }));
};

// ─────────────────────────────────────────────
// U8 — Transacción fallida
// ─────────────────────────────────────────────
export const notifyTransactionFailed = async (transaction, reason = 'Error desconocido') => {
  const email = transaction.userEmail || transaction.createdBy?.email;
  const userId = transaction.createdBy?._id || transaction.createdBy;
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

  await sendEmail({ to: email, subject: `Error en Orden #${transaction.order} - Alyto`, html });

  if (userId) pushSilent(notifyUser(userId, {
    title: '❌ Problema con tu envío',
    body: `Hubo un inconveniente con la orden #${transaction.order}. Contáctanos.`,
    data: { type: 'transaction_failed', orderId: transaction.order }
  }));
};

// ─────────────────────────────────────────────
// U9/U10 — KYC aprobado o rechazado
// ─────────────────────────────────────────────
export const notifyKycResult = async (user, approved, reason = '') => {
  const userId = user._id;
  if (approved) {
    pushSilent(notifyUser(userId, {
      title: '✅ Verificación aprobada',
      body: 'Tu identidad fue verificada. Ahora tienes límites ampliados.',
      data: { type: 'kyc_approved' }
    }));
  } else {
    pushSilent(notifyUser(userId, {
      title: '❌ Verificación rechazada',
      body: `Tu solicitud fue rechazada. Motivo: ${reason || 'Documentos no válidos'}`,
      data: { type: 'kyc_rejected' }
    }));
  }
};

// ─────────────────────────────────────────────
// U11 — Transacción rechazada por admin
// ─────────────────────────────────────────────
export const notifyTransactionRejected = async (transaction, reason) => {
  const userId = transaction.createdBy?._id || transaction.createdBy;
  if (!userId) return;

  pushSilent(notifyUser(userId, {
    title: '❌ Transacción rechazada',
    body: `Tu orden #${transaction.order} fue rechazada. Motivo: ${reason}`,
    data: { type: 'transaction_rejected', orderId: transaction.order }
  }));
};

// ─────────────────────────────────────────────
// A1 — Admin: nuevo depósito BOB pendiente
// ─────────────────────────────────────────────
export const notifyAdminNewManualDeposit = async (transaction) => {
  pushSilent(notifyAdmins({
    title: '🇧🇴 Depósito BOB pendiente',
    body: `Nueva orden #${transaction.order} requiere verificación manual.`,
    data: { type: 'admin_manual_deposit', orderId: transaction.order }
  }));
};

// ─────────────────────────────────────────────
// A2 — Admin: pago Fintoc CL→BO confirmado (payout manual pendiente)
// ─────────────────────────────────────────────
export const notifyAdminManualPayoutPending = async (transaction) => {
  pushSilent(notifyAdmins({
    title: '💸 Payout Bolivia pendiente',
    body: `Fintoc confirmó pago para orden #${transaction.order}. Procesar envío a Bolivia.`,
    data: { type: 'admin_payout_pending', orderId: transaction.order }
  }));
};

// ─────────────────────────────────────────────
// A3 — Admin: nuevo KYC pendiente
// ─────────────────────────────────────────────
export const notifyAdminNewKyc = async (user) => {
  pushSilent(notifyAdmins({
    title: '📋 KYC nuevo para revisar',
    body: `Usuario ${user.name || user.email} subió documentos KYC.`,
    data: { type: 'admin_kyc_pending', userId: String(user._id) }
  }));
};

// ─────────────────────────────────────────────
// U13 — Límite de compliance alcanzado
// ─────────────────────────────────────────────
export const notifyComplianceLimitReached = async (userId, amount, currency) => {
  pushSilent(notifyUser(userId, {
    title: '⚠️ Límite mensual',
    body: `Tu envío de ${amount} ${currency} supera tu límite. Sube tus documentos KYC para ampliarlo.`,
    data: { type: 'compliance_limit_reached' }
  }));
};

// ─────────────────────────────────────────────
// U15 — Bienvenida (Registro)
// ─────────────────────────────────────────────
export const notifyWelcomeUser = async (userId) => {
  pushSilent(notifyUser(userId, {
    title: '👋 ¡Bienvenido!',
    body: 'Tu cuenta fue creada. Completa tu perfil para empezar a enviar dinero.',
    data: { type: 'welcome' }
  }));
};

// ─────────────────────────────────────────────
// A4 — Admin: Transacción de alto riesgo
// ─────────────────────────────────────────────
export const notifyComplianceApprovalRequiredToAdmin = async (transaction) => {
  pushSilent(notifyAdmins({
    title: '🚨 Transacción alto riesgo',
    body: `Orden #${transaction.order} (${transaction.amount} ${transaction.currency}) supera el umbral y requiere aprobación.`,
    data: { type: 'admin_compliance_approval', orderId: transaction.order }
  }));
};

// ─────────────────────────────────────────────
// A7 — Admin: Nuevo usuario registrado
// ─────────────────────────────────────────────
export const notifyAdminNewUser = async (user) => {
  pushSilent(notifyAdmins({
    title: '👤 Nuevo usuario',
    body: `Nuevo registro: ${user.email} (${user.registrationCountry}).`,
    data: { type: 'admin_new_user', userId: String(user._id) }
  }));
};

// ─────────────────────────────────────────────
// A8 — Admin: Transacción rechazada por compliance
// ─────────────────────────────────────────────
export const notifyComplianceRejectToAdmin = async (userEmail, amount, currency, reason) => {
  pushSilent(notifyAdmins({
    title: '🚫 Compliance bloqueó tx',
    body: `Usuario ${userEmail} intentó enviar ${amount} ${currency}. ${reason}`,
    data: { type: 'admin_compliance_reject' }
  }));
};

// ─────────────────────────────────────────────
// A5 — Admin: error en withdrawal automático
// ─────────────────────────────────────────────
export const notifyAdminWithdrawalError = async (transaction, errorMsg) => {
  pushSilent(notifyAdmins({
    title: '⚠️ Error de payout',
    body: `Withdrawal falló para orden #${transaction.order}: ${errorMsg?.slice(0, 60)}`,
    data: { type: 'admin_withdrawal_error', orderId: transaction.order }
  }));
};

// ─────────────────────────────────────────────
// Legacy — Mantener compatibilidad
// ─────────────────────────────────────────────
export const notifyManualPayoutQueued = async (transaction) => {
  const email = transaction.userEmail || transaction.createdBy?.email;
  if (!email) return;

  const html = `
    <div style="${STYLES}">
      ${HEADER}
      <h2 style="color: #ffc107;">Envío en Revisión</h2>
      <p>Hola,</p>
      <p>Tu orden <strong>#${transaction.order}</strong> ha sido recibida y el pago confirmado.</p>
      <p>Debido al destino seleccionado, tu envío está siendo procesado manualmente por nuestro equipo de tesorería.</p>
      <p>Te notificaremos apenas se complete el depósito.</p>
      ${FOOTER}
    </div>
  `;

  await sendEmail({ to: email, subject: `Procesando Envío - Orden #${transaction.order}`, html });
};
