import { Router } from 'express';
import { getListPrices } from '../services/vitaService.js';
import { getPercent } from '../services/markupService.js';
import { findPrice } from '../utils/normalize.js';
import TransactionConfig from '../models/TransactionConfig.js'; // Importar modelo de reglas

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

    // --- LÓGICA PARA MONEDA MANUAL (BOB) ---
    if (origin === 'BOB') {
      // 1. Buscar configuración de Bolivia
      const config = await TransactionConfig.findOne({ originCountry: 'BO' });

      // Usamos la tasa de la BD. Si es 0 o no existe, usamos un fallback de seguridad (ej: 1)
      // Importante: manualExchangeRate debe ser: 1 Unidad Origen = X Unidades Destino (CLP)
      const manualRate = config?.manualExchangeRate || 0;

      if (manualRate <= 0) {
        return res.status(400).json({ ok: false, error: `Tasa de cambio no configurada para ${origin}.` });
      }

      const destCurrency = countryToCurrencyMap[destCountry];
      // ... (resto de validaciones)

      const amountOut = amountIn * manualRate;

      return res.json({
        ok: true,
        data: {
          origin,
          destCountry,
          destCurrency,
          amountIn,
          baseRate: manualRate,
          markupPercent: 0, // En manual, tu ganancia está en el spread de la tasa que defines
          rateWithMarkup: manualRate,
          amountOut,
          minAmount: config?.minAmount || 5000,
          fixedFee: config?.fixedFee || 0,
          validations: [],
          paymentMethods: []
        }
      });
    }

    // --- FIN LÓGICA MANUAL ---

    // Flujo normal para monedas soportadas por Vita (CLP, etc.)
    const prices = await getListPrices();
    const price = findPrice(prices, { originCurrency: origin, destCountry });

    if (!price) {
      return res.status(404).json({ ok: false, error: `No se encontró tasa para ${origin} → ${destCountry}` });
    }

    const baseRate = Number(price.sell_price || 0);
    if (!baseRate) return res.status(422).json({ ok: false, error: 'Tasa base inválida en Vita Prices' });

    const markupPercent = await getPercent(origin, destCountry);
    const rateWithMarkup = baseRate * (1 - (markupPercent / 100));
    const amountOut = amountIn * rateWithMarkup;

    const validations = [];
    if (amountOut <= 0) {
      validations.push(`El monto a enviar es demasiado bajo.`);
    } else if (price.min_amount && amountOut < price.min_amount) {
      validations.push(`Monto menor al mínimo del proveedor (${price.min_amount}).`);
    }

    const destCurrency = countryToCurrencyMap[destCountry];
    if (!destCurrency) return res.status(404).json({ ok: false, error: `Moneda no configurada.` });

    return res.json({
      ok: true,
      data: {
        origin, destCountry, destCurrency, amountIn, baseRate,
        markupPercent, rateWithMarkup, amountOut, minAmount: price.min_amount,
        fixedCost: price.fixed_cost, validations, paymentMethods: price.payment_methods,
      }
    });
  } catch (e) {
    next(e);
  }
});

export default router;