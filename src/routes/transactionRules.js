import { Router } from 'express';
import TransactionConfig from '../models/TransactionConfig.js';
import { protect, isAdmin } from '../middleware/authMiddleware.js';
import { SUPPORTED_ORIGINS } from '../data/supportedOrigins.js'; // Importamos el catálogo

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
      return res.json({
        ok: true, rules: [{
          originCountry: country,
          kycLimits: { level1: 450000, level2: 4500000 },
          minAmount: 5000,
          isEnabled: true
        }]
      });
    }

    res.json({ ok: true, rules });
  } catch (error) {
    console.error('[transactionRules] Error:', error);
    res.status(500).json({ ok: false, error: 'Error al obtener reglas de transacción.' });
  }
});

// GET /api/transaction-rules/available
// ADMIN: Devuelve el catálogo completo de países que el sistema soporta técnicamente
router.get('/available', protect, isAdmin, (req, res) => {
  res.json({ ok: true, origins: SUPPORTED_ORIGINS });
});

// GET /api/transaction-rules/enabled
// PÚBLICO: Devuelve solo los países ACTIVOS (isEnabled: true) para el selector del Home
router.get('/enabled', async (req, res) => {
  try {
    // 1. Buscar configuraciones activas en BD
    const activeConfigs = await TransactionConfig.find({ isEnabled: true });

    // 2. Mapear con la metadata (nombre, moneda)
    const enabledCountries = activeConfigs.map(config => {
      const meta = SUPPORTED_ORIGINS.find(o => o.code === config.originCountry);
      return {
        code: config.originCountry,
        name: meta ? meta.name : config.originCountry,
        currency: meta ? meta.currency : 'UNK',
        minAmount: config.minAmount, // Útil para validaciones en frontend
        alertMessage: config.alertMessage
      };
    });

    res.json({ ok: true, origins: enabledCountries });
  } catch (error) {
    console.error('[transactionRules] Error:', error);
    res.status(500).json({ ok: false, error: 'Error al obtener países activos.' });
  }
});

// GET /api/transaction-rules?country=XX
// PÚBLICO/ADMIN: Obtener reglas específicas de un país
router.get('/', async (req, res) => {
  try {
    const { country } = req.query;
    const query = country ? { originCountry: country.toUpperCase() } : {};

    const rules = await TransactionConfig.find(query);

    // Si piden un país específico y no existe regla, devolvemos default
    if (rules.length === 0 && country) {
      // Valores por defecto para una nueva configuración
      return res.json({
        ok: true, rules: [{
          originCountry: country.toUpperCase(),
          kycLimits: { level1: 450000, level2: 4500000 },
          minAmount: 5000,
          fixedFee: 0,
          isEnabled: false, // Por defecto apagado si es nuevo
          alertMessage: ''
        }]
      });
    }

    res.json({ ok: true, rules });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error al obtener reglas.' });
  }
});

// PUT /api/transaction-rules
// ADMIN: Crear o Actualizar reglas
router.put('/', protect, isAdmin, async (req, res) => {
  try {
    const { originCountry, kycLimits, minAmount, fixedFee, isEnabled, alertMessage } = req.body;

    if (!originCountry) return res.status(400).json({ ok: false, error: 'País obligatorio.' });

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

    res.json({ ok: true, message: 'Reglas actualizadas.', rule });
  } catch (error) {
    console.error('[transactionRules] Error updating:', error);
    res.status(500).json({ ok: false, error: 'Error al guardar.' });
  }
});

export default router;