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
      await Transaction.findOneAndUpdate(
        { order: event?.object?.order },
        { status: 'succeeded', $push: { ipnEvents: vitaEvent._id } }
      );
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