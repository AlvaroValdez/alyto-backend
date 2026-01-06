import { Router } from 'express';
import TransactionConfig from '../models/TransactionConfig.js';
import { protect, isAdmin } from '../middleware/authMiddleware.js';
import { SUPPORTED_ORIGINS } from '../data/supportedOrigins.js';

const router = Router();

// GET /available
router.get('/available', protect, isAdmin, (req, res) => {
  res.json({ ok: true, origins: SUPPORTED_ORIGINS });
});

// GET /enabled
router.get('/enabled', async (req, res) => {
  try {
    const activeConfigs = await TransactionConfig.find({ isEnabled: true });
    const enabledCountries = activeConfigs.map(config => {
      const meta = SUPPORTED_ORIGINS.find(o => o.code === config.originCountry);
      return {
        code: config.originCountry,
        name: meta ? meta.name : config.originCountry,
        currency: meta ? meta.currency : 'UNK',
        minAmount: config.minAmount,
        alertMessage: config.alertMessage
      };
    });
    res.json({ ok: true, origins: enabledCountries });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error al obtener países activos.' });
  }
});

// GET /
router.get('/', async (req, res) => {
  try {
    const { country } = req.query;
    const query = country ? { originCountry: country.toUpperCase() } : {};
    const rules = await TransactionConfig.find(query);

    if (rules.length === 0 && country) {
      return res.json({
        ok: true, rules: [{
          originCountry: country.toUpperCase(),
          kycLimits: { level1: 450000, level2: 4500000 },
          minAmount: 5000,
          fixedFee: 0,
          isEnabled: false,
          alertMessage: '',
          provider: 'vita_wallet',
          manualExchangeRate: 0
        }]
      });
    }
    res.json({ ok: true, rules });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error al obtener reglas.' });
  }
});

// PUT /
router.put('/', protect, isAdmin, async (req, res) => {
  try {
    const body = req.body;
    if (!body.originCountry) return res.status(400).json({ ok: false, error: 'País obligatorio.' });

    const safeNumber = (val, def = 0) => (val !== undefined && val !== null && !isNaN(val)) ? Number(val) : def;

    const updateData = {
      kycLimits: body.kycLimits || { level1: 450000, level2: 4500000 },
      minAmount: safeNumber(body.minAmount, 5000),
      fixedFee: safeNumber(body.fixedFee, 0),
      isEnabled: body.isEnabled,
      alertMessage: body.alertMessage,
      provider: body.provider,
      localBankDetails: body.localBankDetails,
      depositQrImage: body.depositQrImage,
      manualExchangeRate: safeNumber(body.manualExchangeRate, 0),
      feeType: body.feeType || 'percentage',
      feeAmount: safeNumber(body.feeAmount, 0),
      destinations: body.destinations || [], // Permitir guardar array de destinos
      // Payment methods configuration
      paymentMethods: body.paymentMethods || {
        direct: { enabled: true, allowedProviders: [] },
        redirect: { enabled: true }
      }
    };

    const rule = await TransactionConfig.findOneAndUpdate(
      { originCountry: body.originCountry.toUpperCase() },
      updateData,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({ ok: true, message: 'Reglas actualizadas.', rule });
  } catch (error) {
    console.error('[transactionRules] Error updating:', error);
    res.status(500).json({ ok: false, error: 'Error al guardar: ' + error.message });
  }
});

export default router;