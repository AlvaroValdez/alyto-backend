// backend/src/routes/ipn.js
import { Router } from 'express';
import { verifyVitaSignature } from '../middleware/vitaSignature.js';
import VitaEvent from '../models/VitaEvent.js';
import Transaction from '../models/Transaction.js';
import { notifyTransactionFailed } from '../services/notificationService.js';

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

      // 🔄 Si tiene withdrawal diferido pendiente, ejecutarlo ahora
      if (transaction.deferredWithdrawalPayload && transaction.payoutStatus === 'pending') {
        console.log(`[IPN] ⭐ Executing deferred withdrawal for order: ${transaction.order}`);

        try {
          const { createWithdrawal } = await import('../services/vitaService.js');
          const withdrawalResp = await createWithdrawal(transaction.deferredWithdrawalPayload);
          const wData = withdrawalResp?.data ?? withdrawalResp;

          transaction.vitaWithdrawalId = wData?.id || wData?.data?.id || null;
          transaction.payoutStatus = 'processing';
          transaction.status = 'processing';

          console.log(`✅ [IPN] Withdrawal executed: ${transaction.vitaWithdrawalId} (amount: ${transaction.deferredWithdrawalPayload.amount})`);

        } catch (withdrawalError) {
          console.error('[IPN] ❌ Error executing withdrawal:', withdrawalError);
          transaction.payoutStatus = 'failed';
          transaction.status = 'failed';
          transaction.errorMessage = withdrawalError.message;
        }
      } else {
        // Legacy flow (withdrawal ya estaba creado directamente)
        transaction.status = 'succeeded';
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