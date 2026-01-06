import { Router } from 'express';
import Markup from '../models/Markup.js';

const router = Router();

// GET /api/admin/markup - Obtiene todos los markups
router.get('/markup', async (req, res) => {
  try {
    const markups = await Markup.find().sort({ isDefault: -1, originCountry: 1, destCountry: 1 });
    res.json({ ok: true, markups });
  } catch (err) {
    console.error('[adminMarkup] Error al obtener markups:', err);
    res.status(500).json({ ok: false, error: 'Error al obtener markups' });
  }
});

// GET /api/admin/markup/default - Obtiene el markup por defecto global
router.get('/markup/default', async (req, res) => {
  try {
    const defaultMarkup = await Markup.findOne({ isDefault: true });
    res.json({
      ok: true,
      markup: defaultMarkup || null,
      percent: defaultMarkup?.percent || 2.0
    });
  } catch (err) {
    console.error('[adminMarkup] Error al obtener markup por defecto:', err);
    res.status(500).json({ ok: false, error: 'Error al obtener markup por defecto' });
  }
});

// PUT /api/admin/markup/default - Actualiza el markup por defecto global
router.put('/markup/default', async (req, res) => {
  try {
    const { percent } = req.body;
    if (percent === undefined || typeof percent !== 'number') {
      return res.status(400).json({ ok: false, error: 'Percent inválido, debe ser numérico' });
    }

    const defaultMarkup = await Markup.findOneAndUpdate(
      { isDefault: true },
      {
        percent,
        isDefault: true,
        description: 'Spread global por defecto'
      },
      { upsert: true, new: true }
    );

    res.json({ ok: true, markup: defaultMarkup });
  } catch (err) {
    console.error('[adminMarkup] Error al actualizar markup por defecto:', err);
    res.status(500).json({ ok: false, error: 'Error al actualizar markup por defecto' });
  }
});

// POST /api/admin/markup - Crea o actualiza un markup específico
router.post('/markup', async (req, res) => {
  try {
    const { originCountry, destCountry, percent, description } = req.body;

    if (!originCountry || percent === undefined || typeof percent !== 'number') {
      return res.status(400).json({
        ok: false,
        error: 'originCountry y percent son requeridos'
      });
    }

    const filter = { originCountry };
    if (destCountry) {
      filter.destCountry = destCountry;
    } else {
      filter.destCountry = { $exists: false };
    }

    const markup = await Markup.findOneAndUpdate(
      filter,
      {
        originCountry,
        destCountry: destCountry || undefined,
        percent,
        description: description || `${originCountry}${destCountry ? ` → ${destCountry}` : ' (default)'}`
      },
      { upsert: true, new: true }
    );

    res.json({ ok: true, markup });
  } catch (err) {
    console.error('[adminMarkup] Error al guardar markup:', err);
    res.status(500).json({ ok: false, error: 'Error al guardar markup' });
  }
});

// DELETE /api/admin/markup/:id - Elimina un markup específico
router.delete('/markup/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const markup = await Markup.findById(id);
    if (!markup) {
      return res.status(404).json({ ok: false, error: 'Markup no encontrado' });
    }

    if (markup.isDefault) {
      return res.status(400).json({ ok: false, error: 'No se puede eliminar el markup por defecto' });
    }

    await Markup.findByIdAndDelete(id);
    res.json({ ok: true, message: 'Markup eliminado' });
  } catch (err) {
    console.error('[adminMarkup] Error al eliminar markup:', err);
    res.status(500).json({ ok: false, error: 'Error al eliminar markup' });
  }
});

export default router;