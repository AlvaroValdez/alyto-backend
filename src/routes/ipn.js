// backend/src/routes/ipn.js
import { Router } from 'express';
import { verifyVitaSignature } from '../middleware/vitaSignature.js';
import VitaEvent from '../models/VitaEvent.js';
import Transaction from '../models/Transaction.js';
import {
  notifyTransactionFailed,
  notifyPayinSuccess,
  notifyAdminPayinSuccess,
  notifyPayoutProcessing,
  notifyPayoutSuccess,
  notifyAdminPayoutSuccess,
  notifyAdminWithdrawalError
} from '../services/notificationService.js';

const router = Router();

router.post('/vita', verifyVitaSignature, async (req, res) => {
  const event = req.body;

  // Logs para depuración en Render
  process.stdout.write('[ipn] Evento Vita recibido: ' + JSON.stringify(event) + '\n');
  process.stdout.write('[ipn] Headers recibidos: ' + JSON.stringify(req.headers) + '\n');
  process.stdout.write('[ipn] Body recibido (raw): ' + JSON.stringify(event) + '\n');

  try {
    // Guardar el evento en la base de datos
    const vitaEvent = await VitaEvent.create({
      vitaId: event?.id,
      type: event?.type || 'unknown',
      payload: event,
      headers: req.headers,
      verified: true,
    });

    // Actualizar el estado de la transacción correspondiente
    if (event?.type === 'payment.succeeded') {
      const transaction = await Transaction.findOne({ order: event?.object?.order });

      if (!transaction) {
        console.warn(`[IPN] Transaction not found for order: ${event?.object?.order}`);
        return res.json({ ok: true, id: vitaEvent._id });
      }

      // Actualizar payin status
      transaction.payinStatus = 'completed';
      transaction.ipnEvents.push(vitaEvent._id);

      // 🔔 U3 — Notificar usuario: pago recibido
      notifyPayinSuccess(transaction).catch(() => { });

      // 🔔 A2.5 — Notificar admins: pago recibido
      notifyAdminPayinSuccess(transaction).catch(() => { });

      // 🔄 Si tiene withdrawal diferido pendiente, ejecutarlo ahora
      if (transaction.deferredWithdrawalPayload && transaction.payoutStatus === 'pending') {
        console.log(`[IPN] ⭐ Executing deferred withdrawal for order: ${transaction.order}`);

        const { createWithdrawal, forceRefreshPrices } = await import('../services/vitaService.js');
        try {
          const withdrawalResp = await createWithdrawal(transaction.deferredWithdrawalPayload);
          const wData = withdrawalResp?.data ?? withdrawalResp;

          transaction.vitaWithdrawalId = wData?.id || wData?.data?.id || null;
          transaction.payoutStatus = 'processing';
          transaction.status = 'processing';

          // 🔔 U4 — Notificar usuario: envío en proceso
          notifyPayoutProcessing(transaction).catch(() => { });

          console.log(`✅ [IPN] Withdrawal executed: ${transaction.vitaWithdrawalId} (amount: ${transaction.deferredWithdrawalPayload.amount})`);

        } catch (withdrawalError) {
          // 🔄 RETRY: Si falló por precios expirados, refrescar y reintentar
          const errorData = withdrawalError.response?.data?.error || {};
          const msg = `${errorData?.message || ''} ${errorData?.details?.message || ''}`.toLowerCase();

          if (msg.includes('precio') || msg.includes('price') || msg.includes('caducaron')) {
            console.log('[IPN] ⚠️ Precios expirados. Refrescando y reintentando...');
            await forceRefreshPrices();
            await new Promise(r => setTimeout(r, 1500));

            try {
              const retryResp = await createWithdrawal(transaction.deferredWithdrawalPayload);
              const retryData = retryResp?.data ?? retryResp;

              transaction.vitaWithdrawalId = retryData?.id || retryData?.data?.id || null;
              transaction.payoutStatus = 'processing';
              transaction.status = 'processing';
              console.log(`✅ [IPN] Withdrawal executed (retry): ${transaction.vitaWithdrawalId}`);
            } catch (retryError) {
              console.error('[IPN] ❌ Error en retry:', retryError.message);
              transaction.payoutStatus = 'failed';
              transaction.status = 'failed';
              transaction.errorMessage = retryError.message;
              notifyAdminWithdrawalError(transaction, retryError.message).catch(() => { });
            }
          } else {
            console.error('[IPN] ❌ Error executing withdrawal:', withdrawalError.message);
            transaction.payoutStatus = 'failed';
            transaction.status = 'failed';
            transaction.errorMessage = withdrawalError.message;
          }
        }
      } else {
        // Legacy flow (withdrawal ya estaba creado directamente)
        transaction.status = 'succeeded';
      }

      await transaction.save();

    } else if (event?.type === 'payment_order.completed') {
      // Manejar Payment Orders completadas (documentado en BusinessAPI.txt)
      const transaction = await Transaction.findOne({ order: event?.order });

      if (!transaction) {
        console.warn(`[IPN] Transaction not found for Payment Order: ${event?.order}`);
        return res.json({ ok: true, id: vitaEvent._id });
      }

      // Verificar que no se haya procesado ya
      if (transaction.payinStatus === 'completed' && transaction.vitaWithdrawalId) {
        console.log('[IPN] Payment Order already processed');
        return res.json({ ok: true, id: vitaEvent._id });
      }

      // Actualizar estado de Payin
      transaction.payinStatus = 'completed';
      transaction.ipnEvents.push(vitaEvent._id);

      // Extraer metadata del evento IPN o construirlo desde deferredWithdrawalPayload
      let metadata = event?.metadata || transaction.metadata;

      // Fallback: Si no hay metadata en el evento, construirlo desde deferredWithdrawalPayload
      if (!metadata && transaction.deferredWithdrawalPayload) {
        console.log('[IPN] Metadata no en evento. Construyendo desde deferredWithdrawalPayload...');
        metadata = {
          destination: {
            country: transaction.deferredWithdrawalPayload.country,
            currency: transaction.deferredWithdrawalPayload.currency,
            amount: transaction.deferredWithdrawalPayload.amount
          },
          beneficiary: {
            type: transaction.deferredWithdrawalPayload.beneficiary_type,
            first_name: transaction.deferredWithdrawalPayload.beneficiary_first_name,
            last_name: transaction.deferredWithdrawalPayload.beneficiary_last_name,
            email: transaction.deferredWithdrawalPayload.beneficiary_email,
            document_type: transaction.deferredWithdrawalPayload.beneficiary_document_type,
            document_number: transaction.deferredWithdrawalPayload.beneficiary_document_number,
            account_type_bank: transaction.deferredWithdrawalPayload.account_type_bank,
            account_bank: transaction.deferredWithdrawalPayload.account_bank,
            bank_code: transaction.deferredWithdrawalPayload.bank_code
          }
        };
      }

      if (!metadata?.beneficiary || !metadata?.destination) {
        console.error('[IPN] Metadata incompleto en Payment Order:', metadata);
        transaction.payoutStatus = 'failed';
        transaction.status = 'failed';
        await transaction.save();
        return res.json({ ok: true, id: vitaEvent._id });
      }

      // Crear withdrawal con metadata del IPN
      console.log(`[IPN] ⭐ Executing withdrawal for Payment Order: ${event?.order}`);

      const { createWithdrawal, forceRefreshPrices } = await import('../services/vitaService.js');
      const { vita } = await import('../config/env.js');

      try {
        const withdrawalPayload = {
          url_notify: vita.notifyUrl || 'https://google.com',
          currency: String(metadata.destination.currency).toLowerCase(),
          country: String(metadata.destination.country).toUpperCase(),
          amount: Number(metadata.destination.amount),
          order: event.order,
          transactions_type: 'withdrawal',
          wallet: vita.walletUUID,

          beneficiary_type: metadata.beneficiary.type || 'person',
          beneficiary_first_name: metadata.beneficiary.first_name,
          beneficiary_last_name: metadata.beneficiary.last_name,
          beneficiary_email: metadata.beneficiary.email,
          beneficiary_document_type: metadata.beneficiary.document_type,
          beneficiary_document_number: metadata.beneficiary.document_number,
          account_type_bank: metadata.beneficiary.account_type_bank,
          account_bank: metadata.beneficiary.account_bank,
          bank_code: metadata.beneficiary.bank_code,

          purpose: transaction.purpose || 'EPFAMT',
          purpose_comentary: transaction.purpose_comentary || 'Transferencia familiar'
        };

        const withdrawalResp = await createWithdrawal(withdrawalPayload);
        const wData = withdrawalResp?.data ?? withdrawalResp;

        transaction.vitaWithdrawalId = wData?.id || wData?.data?.id || null;
        transaction.payoutStatus = 'processing';
        transaction.status = 'processing';

        console.log(`✅ [IPN] Withdrawal executed for Payment Order: ${transaction.vitaWithdrawalId}`);

      } catch (withdrawalError) {
        // Retry si precios expirados
        const errorData = withdrawalError.response?.data?.error || {};
        const msg = `${errorData?.message || ''} ${errorData?.details?.message || ''}`.toLowerCase();

        if (msg.includes('precio') || msg.includes('price') || msg.includes('caducaron')) {
          console.log('[IPN] ⚠️ Precios expirados. Refrescando...');
          await forceRefreshPrices();
          await new Promise(r => setTimeout(r, 1500));

          try {
            const retryResp = await createWithdrawal(withdrawalPayload);
            const retryData = retryResp?.data ?? retryResp;

            transaction.vitaWithdrawalId = retryData?.id || retryData?.data?.id || null;
            transaction.payoutStatus = 'processing';
            transaction.status = 'processing';
            console.log(`✅ [IPN] Withdrawal executed (retry) for Payment Order: ${transaction.vitaWithdrawalId}`);
          } catch (retryError) {
            console.error('[IPN] ❌ Error en retry:', retryError.message);
            transaction.payoutStatus = 'failed';
            transaction.status = 'failed';
            transaction.errorMessage = retryError.message;
          }
        } else {
          console.error('[IPN] ❌ Error executing withdrawal:', withdrawalError.message);
          transaction.payoutStatus = 'failed';
          transaction.status = 'failed';
          transaction.errorMessage = withdrawalError.message;
        }
      }

      await transaction.save();

    } else if (event?.type === 'payment.failed') {
      // Usar findOne para poder popular y notificar
      const transaction = await Transaction.findOne({ order: event?.object?.order }).populate('createdBy');

      if (transaction) {
        transaction.status = 'failed';
        transaction.ipnEvents.push(vitaEvent._id);
        await transaction.save();

        // Notificar al usuario
        notifyTransactionFailed(transaction, 'Tu pago ha fallado. Por favor intenta nuevamente.').catch(err => console.error('[IPN] Notification error:', err));
      } else {
        console.warn(`[IPN] Transaction not found for order: ${event?.object?.order}`);
      }
    }

    res.json({ ok: true, id: vitaEvent._id });
  } catch (err) {
    process.stderr.write('[ipn] Error guardando evento Vita: ' + err.message + '\n');
    res.status(500).json({ ok: false, error: 'Error al persistir evento' });
  }
});

export default router;