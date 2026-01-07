import { Router } from 'express';
import { getListPrices } from '../services/vitaService.js';

const router = Router();

// GET /api/prices
router.get('/', async (req, res) => {
  try {
    const flatPrices = await getListPrices();

    // 🔍 Inyectar tasas manuales desde TransactionConfig (Ej: Chile -> Bolivia)
    try {
      const { default: TransactionConfig } = await import('../models/TransactionConfig.js');
      const { SUPPORTED_ORIGINS } = await import('../data/supportedOrigins.js');

      const configs = await TransactionConfig.find({ isEnabled: true });

      configs.forEach(conf => {
        if (conf.destinations && conf.destinations.length > 0) {
          // Obtener moneda origen (Ej: CL -> CLP)
          const originInfo = SUPPORTED_ORIGINS.find(o => o.code === conf.originCountry);
          const sourceCurrency = originInfo ? originInfo.currency : 'CLP';

          conf.destinations.forEach(dest => {
            if (dest.isEnabled && dest.manualExchangeRate > 0) {
              // Verificar si ya existe en flatPrices para esa moneda origen
              const exists = flatPrices.find(p =>
                p.code === dest.countryCode &&
                p.sourceCurrency === sourceCurrency
              );

              if (!exists) {
                // Inyectar tasa manual
                // La tasa que espera el frontend suele ser Price (multiplicador).
                // Si la config manualExchangeRate es CLP->BOB (0.0075), lo pasamos tal cual como rate.
                flatPrices.push({
                  code: dest.countryCode,
                  rate: Number(dest.manualExchangeRate),
                  sourceCurrency: sourceCurrency,
                  fixedCost: Number(dest.payoutFixedFee || 0),
                  isManual: true
                });
              }
            }
          });
        }
      });
    } catch (injErr) {
      console.warn('⚠️ [Prices] Error inyectando tasas manuales:', injErr);
    }

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

// GET /api/prices/summary - For admin marquee (Vita rates)
router.get('/summary', async (req, res) => {
  try {
    const allRates = await getListPrices();

    // Filtrar solo CLP rates para display
    const clpRates = allRates
      .filter(r => r.sourceCurrency === 'CLP')
      .map(r => ({
        from: 'CLP',
        to: r.code,
        currency: r.code,
        rate: Number(r.rate).toFixed(4),
        fixedCost: Number(r.fixedCost || 0)
      }))
      .sort((a, b) => a.to.localeCompare(b.to));

    return res.json({
      ok: true,
      data: {
        lastUpdate: new Date().toISOString(),
        rates: clpRates
      }
    });
  } catch (error) {
    console.error('❌ [Prices/Summary] Error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/prices/alyto-summary - Alyto rates (with spread applied)
router.get('/alyto-summary', async (req, res) => {
  try {
    const Markup = (await import('../models/Markup.js')).default;
    const allRates = await getListPrices();

    // Filtrar solo CLP rates
    const clpRates = allRates.filter(r => r.sourceCurrency === 'CLP');

    // Aplicar spread a cada tasa
    const alytoRates = await Promise.all(clpRates.map(async (r) => {
      const destCountry = r.code;

      // Buscar markup (lógica priorizada)
      let markup = await Markup.findOne({ originCountry: 'CL', destCountry });
      if (!markup) {
        markup = await Markup.findOne({ originCountry: 'CL', destCountry: { $exists: false } });
      }
      if (!markup) {
        markup = await Markup.findOne({ isDefault: true });
      }

      const spreadPercent = markup?.percent || 2.0;
      const vitaRate = Number(r.rate);
      const alytoRate = vitaRate * (1 - spreadPercent / 100);

      return {
        from: 'CLP',
        to: r.code,
        currency: r.code,
        vitaRate: vitaRate.toFixed(4),
        alytoRate: alytoRate.toFixed(4),
        spreadPercent: spreadPercent.toFixed(2),
        fixedCost: Number(r.fixedCost || 0)
      };
    }));

    return res.json({
      ok: true,
      data: {
        lastUpdate: new Date().toISOString(),
        rates: alytoRates.sort((a, b) => a.to.localeCompare(b.to))
      }
    });
  } catch (error) {
    console.error('❌ [Prices/AlytoSummary] Error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;