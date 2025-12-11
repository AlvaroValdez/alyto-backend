// backend/src/routes/withdrawalRules.js
// Fuente Vita: GET /api/businesses/withdrawal_rules
// Justificación: proxy directo para exponer campos dinámicos de retiro

import { Router } from 'express';
import { getWithdrawalRules } from '../services/vitaService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const rawData = await getWithdrawalRules();

    // DATA CLEANUP:
    // 1. Detectar si 'rules' viene anidado o si rawData es el objeto de reglas
    // (La API de Vita a veces devuelve { rules: ... } y a veces directo el mapa)
    let rulesMap = rawData.rules || rawData;

    // 2. Normalizar llaves a minúsculas (CO -> co) para que coincida con el frontend
    const cleanRules = {};
    if (rulesMap && typeof rulesMap === 'object') {
      Object.entries(rulesMap).forEach(([key, val]) => {
        cleanRules[key.toLowerCase()] = val;
      });
    }

    // 3. Devolver estructura esperada por Frontend: { data: { rules: ... } }
    res.json({
      ok: true,
      data: {
        rules: cleanRules
      }
    });

  } catch (e) {
    console.error("Error fetching withdrawal rules:", e);
    // Fallback vacío para no romper el front
    res.json({ ok: true, data: { rules: {} } });
  }
});

export default router;