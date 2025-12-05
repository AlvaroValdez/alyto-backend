import { Router } from 'express';
import { getListPrices } from '../services/vitaService.js';
import { getPercent } from '../services/markupService.js';
import { findPrice } from '../utils/normalize.js';
import TransactionConfig from '../models/TransactionConfig.js';

const router = Router();

const countryToCurrencyMap = {
  CO: 'COP', PE: 'PEN', AR: 'ARS', BR: 'BRL', MX: 'MXN', US: 'USD',
  EC: 'USD', VE: 'VES', CL: 'CLP', UY: 'UYU', PY: 'PYG', BO: 'BOB',
  CN: 'CNY', HT: 'HTG', CR: 'CRC', GB: 'GBP', EU: 'EUR', DO: 'DOP',
  PA: 'USD', GT: 'GTQ', PL: 'PLN', AU: 'AUD', SV: 'USD', ES: 'EUR',
};

router.get('/quote', async (req, res, next) => {
  try {
    const origin = (req.query.origin || 'CLP').toUpperCase();
    const destCountry = (req.query.destCountry || '').toUpperCase();
    const amountIn = Number(req.query.amount || 0);

    if (!destCountry) return res.status(400).json({ ok: false, error: 'destCountry requerido' });
    if (!amountIn || amountIn <= 0) return res.status(400).json({ ok: false, error: 'amount debe ser > 0' });

    // --- LÓGICA MANUAL PARA BOB ---
    if (origin === 'BOB') {
      const config = await TransactionConfig.findOne({ originCountry: 'BO' });
      const manualRate = config?.manualExchangeRate || 0;

      if (manualRate <= 0) {
        return res.status(400).json({ ok: false, error: `Tasa no configurada para ${origin}.` });
      }

      const destCurrency = countryToCurrencyMap[destCountry];
      if (!destCurrency) return res.status(404).json({ ok: false, error: `Moneda destino no soportada.` });

      const amountOut = amountIn * manualRate;

      return res.json({
        ok: true,
        data: {
          origin, destCountry, destCurrency, amountIn,
          baseRate: manualRate, markupPercent: 0, rateWithMarkup: manualRate,
          amountOut,
          minAmount: config?.minAmount || 5000,
          fixedFee: config?.fixedFee || 0,
          validations: [], paymentMethods: []
        }
      });
    }

    // --- LÓGICA ESTÁNDAR VITA WALLET ---
    const prices = await getListPrices();
    const price = findPrice(prices, { originCurrency: origin, destCountry });

    if (!price) return res.status(404).json({ ok: false, error: `No se encontró tasa para ${origin} → ${destCountry}` });

    const baseRate = Number(price.sell_price || 0);
    if (!baseRate) return res.status(422).json({ ok: false, error: 'Tasa base inválida' });

    const markupPercent = await getPercent(origin, destCountry);
    const rateWithMarkup = baseRate * (1 - (markupPercent / 100));
    const amountOut = amountIn * rateWithMarkup;
    const destCurrency = countryToCurrencyMap[destCountry];

    return res.json({
      ok: true,
      data: {
        origin, destCountry, destCurrency, amountIn, baseRate,
        markupPercent, rateWithMarkup, amountOut, minAmount: price.min_amount,
        fixedCost: price.fixed_cost, validations: [], paymentMethods: price.payment_methods,
      }
    });

  } catch (e) {
    next(e);
  }
});

export default router;