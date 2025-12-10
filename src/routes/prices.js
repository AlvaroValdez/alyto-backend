import { Router } from 'express';
import { getListPrices } from '../services/vitaService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const data = await getListPrices();
    res.json({ ok: true, data });
  } catch (e) {
    next(e);
  }
});

export default router;