import { Router } from 'express';
// Importa el modelo Markup directamente (ya debe estar usando ES Modules)
import Markup from '../models/Markup.js'; 
// Importa las funciones del servicio (ya deben estar usando ES Modules)
import { getOrInit, upsertDefault, upsertPair } from '../services/markupService.js';

const router = Router();

// GET /api/admin/markup - Obtiene el markup por defecto
router.get('/markup', async (req, res) => {
  try {
    // getOrInit asegura que el documento exista antes de intentar leerlo
    const settings = await getOrInit(); 
    res.json({ ok: true, markup: settings.defaultPercent });
  } catch (err) {
    console.error('[adminMarkup] Error al obtener markup por defecto:', err);
    res.status(500).json({ ok: false, error: 'Error al obtener markup por defecto' });
  }
});

// PUT /api/admin/markup - Actualiza el markup por defecto
router.put('/markup', async (req, res) => {
  try {
    const { markup } = req.body;
    if (markup === undefined || typeof markup !== 'number') {
      return res.status(400).json({ ok: false, error: 'Markup inválido, debe ser numérico' });
    }
    // upsertDefault maneja la lógica de creación/actualización
    const settings = await upsertDefault(markup); 
    res.json({ ok: true, markup: settings.defaultPercent });
  } catch (err) {
    console.error('[adminMarkup] Error al actualizar markup por defecto:', err);
    res.status(500).json({ ok: false, error: 'Error al actualizar markup por defecto' });
  }
});

// GET /api/admin/markup/pairs - Devuelve la lista de pares configurados
router.get('/markup/pairs', async (req, res) => {
  try {
    const settings = await getOrInit();
    res.json({ ok: true, pairs: settings.pairs });
  } catch (err) {
    console.error('[adminMarkup] Error al obtener pares de markup:', err);
    res.status(500).json({ ok: false, error: 'Error al obtener pares de markup' });
  }
});

// PUT /api/admin/markup/pairs - Añade o actualiza un par específico
router.put('/markup/pairs', async (req, res) => {
  try {
    const { originCurrency, destCountry, percent } = req.body;
    if (!originCurrency || !destCountry || percent === undefined || typeof percent !== 'number') {
      return res.status(400).json({ ok: false, error: 'Datos de par inválidos (originCurrency, destCountry, percent requeridos)' });
    }
    // upsertPair maneja la lógica de añadir/actualizar y devuelve el documento completo
    const updatedSettings = await upsertPair(originCurrency, destCountry, percent); 
    res.json({ ok: true, pairs: updatedSettings.pairs });
  } catch (err) {
    console.error('[adminMarkup] Error al actualizar par de markup:', err);
    res.status(500).json({ ok: false, error: 'Error al actualizar par de markup' });
  }
});

export default router;