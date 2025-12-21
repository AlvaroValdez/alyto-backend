import { Router } from 'express';
import { getListPrices } from '../services/vitaService.js';

const router = Router();

// GET /api/prices
router.get('/', async (req, res) => {
  try {
    const flatPrices = await getListPrices();

    // 1. Construir Mapa de Tasas
    const sellMap = {};
    flatPrices.forEach(p => {
      if (p.code && p.rate) {
        sellMap[p.code.toLowerCase()] = Number(p.rate);
        sellMap[p.code.toUpperCase()] = Number(p.rate);
      }
    });

    // 2. Estructura Jerárquica (Legacy)
    const legacyStructure = {
      withdrawal: {
        prices: {
          attributes: { sell: sellMap },
          sell: sellMap
        },
        sell: sellMap
      }
    };

    // 3. Objeto Raíz (Simulando API Vita original)
    const fullData = {
      // Estructuras anidadas (Lo que busca el Legacy FE)
      CLP: legacyStructure,
      clp: legacyStructure,
      USD: legacyStructure,
      usd: legacyStructure,

      // Array plano (Por si alguna parte moderna lo busca como lista)
      data: flatPrices,
      results: flatPrices
    };

    // 4. 🔥 CAMBIO CRÍTICO: Enviamos fullData DIRECTO (Sin { ok: true ... })
    // Así 'res.data.CLP' existirá en el Frontend.
    res.status(200).json(fullData);

  } catch (error) {
    console.error("❌ [Prices Route] Error:", error.message);
    // En caso de error, devolvemos objeto vacío para no romper
    res.status(200).json({});
  }
});

export default router;