import { sendEmail } from './emailService.js';
import { sendPushNotification, notifyUser, notifyAdmins } from './fcmService.js';

/**
 * Servicio Centralizado de Notificaciones
 * Envía email + push en paralelo (fire-and-forget para push)
 */

// ─── Shared branded helpers ────────────────────────────────────────────────

const emailWrapper = (bodyContent) => `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

        <!-- HEADER -->
        <tr>
          <td style="background-color:#233E58;padding:28px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">
              al<span style="color:#F5C400;">y</span>to
            </h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.65);font-size:12px;letter-spacing:1px;text-transform:uppercase;">Envíos Internacionales</p>
          </td>
        </tr>

        <!-- YELLOW ACCENT BAR -->
        <tr><td style="height:4px;background:linear-gradient(90deg,#F5C400 0%,#00A89D 100%);"></td></tr>

        <!-- BODY -->
        <tr>
          <td style="padding:36px 40px;color:#333333;font-size:15px;line-height:1.7;">
            ${bodyContent}
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background-color:#f8f9fa;padding:24px 40px;border-top:1px solid #e9ecef;text-align:center;">
            <p style="margin:0 0 6px;color:#666;font-size:13px;font-weight:600;">Gracias por confiar en Alyto</p>
            <p style="margin:0;color:#aaa;font-size:11px;">Este es un correo automático — por favor no respondas a esta dirección.</p>
            <p style="margin:12px 0 0;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#233E58;margin:0 2px;"></span>
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#F5C400;margin:0 2px;"></span>
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#00A89D;margin:0 2px;"></span>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
`;

const infoBox = (content, color = '#00A89D') => `
  <div style="background:${color}18;border-left:4px solid ${color};border-radius:0 8px 8px 0;padding:14px 18px;margin:20px 0;font-size:14px;">
    ${content}
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

  const html = emailWrapper(`
    <h2 style="margin:0 0 8px;color:#233E58;font-size:20px;">Orden de Pago Creada</h2>
    <p style="margin:0 0 16px;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Hemos recibido tu solicitud</p>
    <p style="margin:0 0 16px;">Hola, tu solicitud de envío de dinero fue generada exitosamente. A continuación los detalles:</p>
    ${infoBox(`
      <strong style="display:block;margin-bottom:6px;color:#233E58;">Detalles de la Orden</strong>
      Nº Orden: <strong>#${orderId}</strong><br>
      Monto: <strong>${amount} CLP</strong><br>
      Destino: <strong>${country}</strong>
    `)}
    <p>Por favor, completa el pago para que procesemos tu envío de inmediato.</p>
  `);

  await sendEmail({ to: email, subject: `Orden #${orderId} Creada — Alyto`, html });

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

  const html = emailWrapper(`
    <h2 style="margin:0 0 8px;color:#233E58;font-size:20px;">✅ Pago Recibido</h2>
    <p style="margin:0 0 16px;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Todo en orden</p>
    <p>Confirmamos la recepción de tu pago para la orden <strong>#${transaction.order}</strong>.</p>
    ${infoBox(`<strong>Estado actual:</strong> Procesando envío al destinatario`, '#00A89D')}
    <p>Te notificaremos en cuanto los fondos sean enviados.</p>
  `);

  await sendEmail({ to: email, subject: `Pago Confirmado — Orden #${transaction.order} | Alyto`, html });

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

  const html = emailWrapper(`
    <h2 style="margin:0 0 8px;color:#233E58;font-size:20px;">🎉 ¡Envío Completado!</h2>
    <p style="margin:0 0 16px;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Tu beneficiario recibió los fondos</p>
    <p>Los fondos de la orden <strong>#${transaction.order}</strong> han sido enviados al destinatario exitosamente.</p>
    ${infoBox(`
      <strong style="display:block;margin-bottom:6px;color:#233E58;">Resumen del Envío</strong>
      Monto enviado: <strong>${transaction.amountSent} ${transaction.currencySent}</strong><br>
      Referencia: <strong>${transaction.vitaWithdrawalId || 'N/A'}</strong>
    `, '#00A89D')}
    <p style="color:#666;font-size:13px;">Dependiendo del banco destino, los fondos pueden tardar unas horas en reflejarse.</p>
  `);

  await sendEmail({ to: email, subject: `¡Envío Completado! — Orden #${transaction.order} | Alyto`, html });

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
    const html = emailWrapper(`
      <h2 style="margin:0 0 8px;color:#233E58;font-size:20px;">🎉 Transferencia Enviada</h2>
      <p style="margin:0 0 16px;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Tu envío fue procesado</p>
      <p>Tu envío para la orden <strong>#${transaction.order}</strong> fue procesado exitosamente.</p>
      ${infoBox(`
        <strong>Estado:</strong> Completado ✓<br>
        Puedes ver el comprobante bancario en el detalle de tu transacción dentro de la app.
      `, '#00A89D')}
    `);
    await sendEmail({ to: email, subject: `Transferencia Completada — Orden #${transaction.order} | Alyto`, html }).catch(() => { });
  }

  if (userId) pushSilent(notifyUser(userId, {
    title: '🎉 Transferencia enviada',
    body: `Tu envío fue completado. Revisa el comprobante bancario.`,
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

  const html = emailWrapper(`
    <h2 style="margin:0 0 8px;color:#c0392b;font-size:20px;">⚠️ Problema con tu Envío</h2>
    <p style="margin:0 0 16px;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Se requiere tu atención</p>
    <p>Hubo un inconveniente con la orden <strong>#${transaction.order}</strong>.</p>
    ${infoBox(`<strong>Motivo:</strong> ${reason}`, '#c0392b')}
    <p>Por favor contacta a nuestro soporte si el problema persiste o si ya se descontó el dinero de tu cuenta.</p>
  `);

  await sendEmail({ to: email, subject: `Atención Requerida — Orden #${transaction.order} | Alyto`, html });

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
  const statusLabel = approved ? '✅ Aprobado' : '❌ Rechazado';

  // Push al usuario
  pushSilent(notifyUser(userId, {
    title: `KYC ${statusLabel}`,
    body: approved
      ? '¡Tu identidad fue verificada! Ya puedes enviar dinero sin restricciones.'
      : `Tu solicitud fue rechazada. Motivo: ${reason || 'Documentos no válidos'}`,
    data: { type: approved ? 'kyc_approved' : 'kyc_rejected' }
  }));

  // Email al usuario
  if (user.email) {
    const html = emailWrapper(`
      <h2 style="margin:0 0 8px;color:#233E58;font-size:20px;">Verificación de Identidad ${statusLabel}</h2>
      <p style="margin:0 0 16px;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Actualización de tu cuenta Alyto</p>
      <p>Hola <strong>${user.name || user.email}</strong>,</p>
      ${approved
        ? `<p>Tu identidad ha sido verificada exitosamente. Ya puedes realizar envíos con los límites completos de tu nivel.</p>
           ${infoBox('<strong>¡Bienvenido a Alyto verificado!</strong> Inicia sesión y comienza a enviar.', '#00A89D')}`
        : `<p>Lamentablemente tu solicitud de verificación fue rechazada.</p>
           ${reason ? infoBox(`<strong>Motivo:</strong> ${reason}`, '#dc3545') : ''}
           <p>Puedes corregir tus documentos y volver a enviarlos desde tu perfil.</p>`
      }
    `);
    sendEmail({
      to: user.email,
      subject: `Verificación KYC ${statusLabel} — Alyto`,
      html,
    }).catch(err => console.error('[notifyKycResult] Email error:', err.message));
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
// A1.5 — Admin: nueva transacción creada (NOTIFICACIÓN GENERAL)
// ─────────────────────────────────────────────
export const notifyAdminNewTransaction = async (transaction) => {
  pushSilent(notifyAdmins({
    title: '💸 Nueva Transacción',
    body: `El usuario ${transaction.createdBy?.email || 'Desconocido'} ha creado la orden #${transaction.order} (${transaction.amount} ${transaction.currency}).`,
    data: { type: 'admin_new_transaction', orderId: transaction.order }
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
// A2.5 — Admin: pago Fintoc confirmado (general payin)
// ─────────────────────────────────────────────
export const notifyAdminPayinSuccess = async (transaction) => {
  pushSilent(notifyAdmins({
    title: '✅ Pago de cliente recibido',
    body: `El cliente para la orden #${transaction.order} ha pagado exitosamente.`,
    data: { type: 'admin_payin_success', orderId: transaction.order }
  }));
};

// ─────────────────────────────────────────────
// A2.6 — Admin: Payout automátizado completado (Vita)
// ─────────────────────────────────────────────
export const notifyAdminPayoutSuccess = async (transaction) => {
  pushSilent(notifyAdmins({
    title: '🎉 Envío completado (Vita)',
    body: `La orden #${transaction.order} fue procesada exitosamente por Vita.`,
    data: { type: 'admin_payout_success', orderId: transaction.order }
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
