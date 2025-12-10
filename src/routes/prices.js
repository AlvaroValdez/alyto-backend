// src/routes/prices.js
import express from 'express';
import { getListPrices } from '../services/vitaService.js'; // Asegúrate de importar tu servicio nuevo

const router = express.Router();

// GET /api/prices
router.get('/', async (req, res) => {
  try {
    const prices = await getListPrices();
    res.json(prices); // Devuelve el array limpio directamente
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;