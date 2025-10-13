const router = require('express').Router();
const { getListPrices } = require('../services/vitaService');
const { getPercent } = require('../services/markupService');
const { findPrice } = require('../utils/normalize');

// Mapeo para obtener la moneda a partir del código del país
const countryToCurrencyMap = {
  CN: 'CNY', // Yuan chino
  HT: 'HTG', // Gourde haitiano
  CR: 'CRC', // Colón costarricense
  GB: 'GBP', // Libra esterlina
  EU: 'EUR', // Euro
  EC: 'USD', // Dólar estadounidense
  DO: 'DOP', // Peso dominicano
  PY: 'PYG', // Guaraní paraguayo
  PA: 'USD', // Dólar estadounidense
  MX: 'MXN', // Peso mexicano
  GT: 'GTQ', // Quetzal guatemalteco
  UY: 'UYU', // Peso uruguayo
  CO: 'COP', // Peso colombiano
  PL: 'PLN', // Zloty polaco
  AU: 'AUD', // Dólar australiano
  SV: 'USD', // Dólar estadounidense
  BR: 'BRL', // Real brasileño
  BO: 'BOB', // Boliviano
  US: 'USD', // Dólar estadounidense
  PE: 'PEN', // Sol peruano
  AR: 'ARS', // Peso argentino
  ES: 'EUR', // Euro
  CL: 'CLP', // Peso chileno
  VE: 'VES', // Bolívar soberano
};

router.get('/quote', async (req, res, next) => {
  try {
    // 1. Extracción y normalización de parámetros de la URL
    const origin = (req.query.origin || 'CLP').toUpperCase();
    const destCountry = (req.query.destCountry || '').toUpperCase();
    const amountIn = Number(req.query.amount || 0);

    // 2. Validaciones iniciales
    if (!destCountry) {
      return res.status(400).json({ ok: false, error: 'destCountry requerido' });
    }
    if (!amountIn || amountIn <= 0) {
      return res.status(400).json({ ok: false, error: 'amount debe ser > 0' });
    }

    // 3. Obtención de precios y búsqueda del par correcto
    const prices = await getListPrices();
    const price = findPrice(prices, { originCurrency: origin, destCountry });

    if (!price) {
      return res.status(404).json({ ok: false, error: `No se encontró tasa para ${origin} → ${destCountry}` });
    }

    // 4. Cálculo de la tasa con markup
    const baseRate = Number(price.sell_price || 0);
    if (!baseRate) {
      return res.status(422).json({ ok: false, error: 'Tasa base inválida en Vita Prices' });
    }
    
    const markupPercent = await getPercent(origin, destCountry);
    const rateWithMarkup = baseRate * (1 - (markupPercent / 100));
    const amountOut = amountIn * rateWithMarkup;

    // 5. Validaciones de negocio (monto mínimo, etc.)
    const validations = [];
    if (amountOut <= 0) {
        validations.push(`El monto a enviar es demasiado bajo para ser procesado.`);
    } else if (price.min_amount && amountOut < price.min_amount) {
        validations.push(`El monto a recibir (${amountOut.toFixed(2)}) es menor al mínimo del proveedor (${price.min_amount}).`);
    }

    // 6. Obtención de la moneda de destino (la corrección clave)
    const destCurrency = countryToCurrencyMap[destCountry];
    if (!destCurrency) {
      return res.status(404).json({ ok: false, error: `La moneda para el país ${destCountry} no está configurada.` });
    }

    // 7. Construcción de la respuesta final y completa
    return res.json({
      ok: true,
      data: {
        origin,
        destCountry,
        destCurrency,
        amountIn,
        baseRate,
        markupPercent,
        rateWithMarkup,
        amountOut,
        minAmount: price.min_amount,
        fixedCost: price.fixed_cost,
        validations,
        paymentMethods: price.payment_methods,
      }
    });
  } catch (e) { 
    next(e); 
  }
});

module.exports = router;