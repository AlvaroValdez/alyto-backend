// backend/src/routes/adminMarkup.js
// Justificación: permitir al admin leer y actualizar el markup FX
// Fuente: lógica interna AVF (no en Vita)

const router = require('express').Router();
const FxSettings = require('../models/FxSettings');

// GET /api/admin/markup
router.get('/markup', async (req, res) => {
  try {
    let settings = await FxSettings.findOne();
    if (!settings) {
      settings = await FxSettings.create({ markup: 0.03 }); // valor inicial
    }
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

    let settings = await FxSettings.findOne();
    if (!settings) {
      settings = await FxSettings.create({ markup });
    } else {
      settings.markup = markup;
      await settings.save();
    }

    res.json({ ok: true, markup: settings.markup });
  } catch (err) {
    console.error('[adminMarkup] Error al actualizar markup:', err);
    res.status(500).json({ ok: false, error: 'Error al actualizar markup' });
  }
});

module.exports = router;
