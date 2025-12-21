// backend/src/routes/withdrawalRules.js
// Fuente Vita: GET /withdrawal_rules
// Justificación: proxy directo para exponer campos dinámicos de retiro

import { Router } from 'express';
import { getWithdrawalRules } from '../services/vitaService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const data = await getWithdrawalRules();
    res.json({ ok: true, data });
  } catch (e) {
    next(e);
  }
});

export default router;