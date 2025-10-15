// backend/src/middleware/vitaSignature.js
// Fuente: Vita Wallet docs - Webhooks V2-HMAC-SHA256
// Justificación: verificar que los IPN sean auténticos.
import crypto from 'crypto';
import { vita } from '../config/env.js';

function verifyVitaSignature(req, res, next) {
  try {
    const date = req.header('X-Date');
    const login = req.header('X-Login');
    const authHeader = req.header('Authorization') || '';

    if (!date || !login || !authHeader) {
      return res.status(401).json({ ok: false, error: 'Faltan headers Vita' });
    }

    // Extraer firma del header
    const signature = authHeader.split('Signature:')[1]?.trim();
    if (!signature) {
      return res.status(401).json({ ok: false, error: 'Firma Vita no encontrada' });
    }

    // Construir string para firmar
    const rawPayload = JSON.stringify(req.body);
    const toSign = `${login}${date}${rawPayload}`;

    // Calcular firma esperada
    const hmac = crypto.createHmac('sha256', vita.secret);
    hmac.update(toSign);
    const expected = hmac.digest('hex');

    if (signature !== expected) {
      console.warn('[ipn] Firma inválida:', { expected, received: signature });
      return res.status(401).json({ ok: false, error: 'Firma Vita inválida' });
    }

    console.log('[ipn] Firma verificada correctamente');
    next();
  } catch (err) {
    console.error('[ipn] Error verificando firma Vita:', err);
    res.status(500).json({ ok: false, error: 'Error interno en verificación Vita' });
  }
}

export { verifyVitaSignature };
