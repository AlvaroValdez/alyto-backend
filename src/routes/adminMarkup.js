import { Router } from 'express';
import Markup from '../models/Markup.js'; // Asegúrate que la importación del modelo sea correcta
import { getOrInit, upsertDefault, upsertPair } from '../services/markupService.js';

const router = Router();

// --- Ruta para el markup por defecto (sin cambios) ---
router.get('/markup', async (req, res) => {
  try {
    const settings = await getOrInit();
    res.json({ ok: true, markup: settings.defaultPercent });
  } catch (err) {
    console.error('[adminMarkup] Error al obtener markup por defecto:', err);
    res.status(500).json({ ok: false, error: 'Error al obtener markup por defecto' });
  }
});

router.put('/markup', async (req, res) => {
  try {
    const { markup } = req.body;
    if (markup === undefined || typeof markup !== 'number') {
      return res.status(400).json({ ok: false, error: 'Markup inválido' });
    }
    const settings = await upsertDefault(markup);
    res.json({ ok: true, markup: settings.defaultPercent });
  } catch (err) {
    console.error('[adminMarkup] Error al actualizar markup por defecto:', err);
    res.status(500).json({ ok: false, error: 'Error al actualizar markup por defecto' });
  }
});

// --- NUEVAS RUTAS PARA COMISIONES POR PAR ---

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
      return res.status(400).json({ ok: false, error: 'Datos de par inválidos' });
    }
    
    // --- CORRECCIÓN CLAVE ---
    // Capturamos el documento actualizado devuelto por upsertPair
    const updatedSettings = await upsertPair(originCurrency, destCountry, percent);
    
    // Usamos el documento actualizado para enviar la respuesta
    res.json({ ok: true, pairs: updatedSettings.pairs }); 
    
  } catch (err) {
    console.error('[adminMarkup] Error al actualizar par de markup:', err);
    res.status(500).json({ ok: false, error: 'Error al actualizar par de markup' });
  }
});

export default router;