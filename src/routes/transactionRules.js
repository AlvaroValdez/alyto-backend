import { Router } from 'express';
import TransactionConfig from '../models/TransactionConfig.js';
import { protect, isAdmin } from '../middleware/authMiddleware.js';

const router = Router();

// GET /api/transaction-rules?country=CL
// PÚBLICO: El frontend necesita esto antes de que el usuario se loguee para validar montos
router.get('/', async (req, res) => {
  try {
    const { country } = req.query;
    // Si no envían país, devolvemos todas (o por defecto CL)
    const query = country ? { originCountry: country.toUpperCase() } : {};
    
    const rules = await TransactionConfig.find(query);
    
    // Si no hay reglas configuradas, devolvemos un objeto por defecto seguro
    if (rules.length === 0 && country) {
        return res.json({ ok: true, rules: [{ 
            originCountry: country, 
            kycLimits: { level1: 450000, level2: 4500000 }, 
            minAmount: 5000, 
            isEnabled: true 
        }]});
    }

    res.json({ ok: true, rules });
  } catch (error) {
    console.error('[transactionRules] Error:', error);
    res.status(500).json({ ok: false, error: 'Error al obtener reglas de transacción.' });
  }
});

// PUT /api/transaction-rules
// ADMIN: Crear o Actualizar reglas para un país
router.put('/', protect, isAdmin, async (req, res) => {
  try {
    const { originCountry, kycLimits, minAmount, fixedFee, isEnabled, alertMessage } = req.body;

    if (!originCountry) {
      return res.status(400).json({ ok: false, error: 'El país de origen es obligatorio.' });
    }

    // upsert: true crea el documento si no existe
    const rule = await TransactionConfig.findOneAndUpdate(
      { originCountry: originCountry.toUpperCase() },
      { 
        kycLimits, 
        minAmount: Number(minAmount), 
        fixedFee: Number(fixedFee), 
        isEnabled, 
        alertMessage 
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({ ok: true, message: 'Reglas actualizadas correctamente.', rule });
  } catch (error) {
    console.error('[transactionRules] Error updating:', error);
    res.status(500).json({ ok: false, error: 'Error al guardar las reglas.' });
  }
});

export default router;