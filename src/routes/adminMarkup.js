// backend/src/routes/adminMarkup.js
// Justificación: permitir al admin leer y actualizar el markup FX
// Fuente: lógica interna AVF (no en Vita)

import { Router } from 'express';
import FxSettings from '../models/FxSettings.js';

const router = Router();

// GET /api/admin/markup
router.get('/markup', async (req, res) => {
  try {
    const settings = await FxSettings.findOneAndUpdate(
      {}, // Busca cualquier documento
      { $setOnInsert: { markup: 0.03 } }, // Si no existe, lo crea con este valor
      { upsert: true, new: true } // Opciones: crea si no existe y devuelve el documento nuevo
    );
    res.json({ ok: true, markup: settings.markup });
  } catch (err) {
    console.error('[adminMarkup] Error al obtener markup:', err);
    res.status(500).json({ ok: false, error: 'Error al obtener markup' });
  }
});

// PUT /api/admin/markup
router.put('/markup', async (req, res) => {
  try {
    const { markup } = req.body;
    if (markup === undefined || typeof markup !== 'number') {
      return res.status(400).json({ ok: false, error: 'Markup inválido, debe ser numérico' });
    }

    const settings = await FxSettings.findOneAndUpdate(
      {},
      { $set: { markup: markup } },
      { upsert: true, new: true }
    );

    res.json({ ok: true, markup: settings.markup });
  } catch (err) {
    console.error('[adminMarkup] Error al actualizar markup:', err);
    res.status(500).json({ ok: false, error: 'Error al actualizar markup' });
  }
});

export default router;