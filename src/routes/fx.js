import { Router } from 'express';
import { getListPrices } from '../services/vitaService.js';
import TransactionConfig from '../models/TransactionConfig.js';
import { SUPPORTED_ORIGINS } from '../data/supportedOrigins.js';

const router = Router();

// GET /api/fx/quote
// Ejemplo clásico: ?amount=25000&destCountry=CO&origin=CLP
// Caso Bolivia:     ?amount=100&destCountry=CO&origin=BOB&originCountry=BO
router.get('/quote', async (req, res) => {
  try {
    const { amount, destCountry, origin, originCountry } = req.query;

    const originCurrency = (origin || 'CLP').toUpperCase();

    // Si FE no manda originCountry, intentamos deducirlo por moneda
    const safeOriginCountry = (
      originCountry ||
      (SUPPORTED_ORIGINS.find(o => o.currency === originCurrency)?.code) ||
      'CL'
    ).toUpperCase();

    console.log(`🧮 [FX] Solicitud: ${amount} ${originCurrency} (${safeOriginCountry}) -> ${destCountry}`);

    if (!amount || !destCountry) {
      return res.status(400).json({ ok: false, error: 'Faltan parámetros (amount, destCountry)' });
    }

    // 1) Obtener tasas Vita para tramo CLP -> destino
    const prices = await getListPrices();

    // 2) Encontrar tasa destino (flexible)
    const targetCode = destCountry.toUpperCase();
    const priceData = prices.find(p => {
      const pCode = p.code.toUpperCase();
      return pCode === targetCode || pCode === `${targetCode}P` || pCode.startsWith(targetCode);
    });

    if (!priceData) {
      return res.status(404).json({ ok: false, error: `No hay tasa disponible para el país ${destCountry}` });
    }

    const clpToDestRate = Number(priceData.rate);
    const inputAmount = Number(amount);

    // --- Caso 1: Origen CLP (flujo actual, intacto) ---
    if (originCurrency === 'CLP') {
      // 💰 Obtener comisión desde Markup
      const Markup = (await import('../models/Markup.js')).default;

      // Buscar markup específico para CLP→destCountry
      const markupPair = await Markup.findOne({
        originCurrency: 'CLP',
        destCountry: targetCode
      });

      // Si no existe par específico, usar default
      const defaultMarkup = await Markup.findOne({ isDefault: true });
      const feePercent = markupPair?.percent || defaultMarkup?.percent || 0;

      const feeCLP = inputAmount * (feePercent / 100);
      const clpAmountWithFee = inputAmount + feeCLP;
      const finalAmount = inputAmount * clpToDestRate;

      return res.json({
        ok: true,
        data: {
          originCurrency,
          originCountry: safeOriginCountry,
          destCurrency: priceData.code,
          rate: clpToDestRate,
          amount: inputAmount,
          fee: Number(feeCLP.toFixed(2)),
          feePercent: Number(feePercent.toFixed(2)),
          clpAmountWithFee: Number(clpAmountWithFee.toFixed(2)),
          receiveAmount: Number(finalAmount.toFixed(2)),
          currency: priceData.code
        }
      });
    }

    // --- Caso 2: Origen manual (Bolivia BOB) ---
    // Requiere TransactionConfig: isEnabled=true, provider=internal_manual, manualExchangeRate>0
    const config = await TransactionConfig.findOne({ originCountry: safeOriginCountry });

    if (
      !config ||
      !config.isEnabled ||
      config.provider !== 'internal_manual' ||
      !config.manualExchangeRate ||
      Number(config.manualExchangeRate) <= 0
    ) {
      return res.status(422).json({
        ok: false,
        error: `Origen manual no configurado para ${safeOriginCountry}. Habilítalo en Admin → Reglas (provider=internal_manual, isEnabled=true, manualExchangeRate>0).`,
        details: {
          originCountry: safeOriginCountry,
          originCurrency,
          provider: config?.provider || null,
          isEnabled: config?.isEnabled || false,
          manualExchangeRate: config?.manualExchangeRate || 0
        }
      });
    }

    // manualExchangeRate = CLP por 1 unidad de moneda origen (ej: 1 BOB = 140 CLP)
    const manualExchangeRate = Number(config.manualExchangeRate);
    const clpAmount = inputAmount * manualExchangeRate;

    // 💰 Cálculo de comisión
    let feePercent = 0;
    let feeCLP = 0;
    let feeOriginAmount = 0;

    if (config.feeType === 'percentage') {
      feePercent = config.feeAmount || 0;
      feeCLP = clpAmount * (feePercent / 100);
      feeOriginAmount = inputAmount * (feePercent / 100);
    } else if (config.feeType === 'fixed') {
      feeCLP = config.feeAmount || 0;
      feePercent = clpAmount > 0 ? (feeCLP / clpAmount) * 100 : 0;
      feeOriginAmount = feeCLP / manualExchangeRate;
    }

    // 🔍 DEBUG FEE
    console.log('🔍 [FX] Config para', safeOriginCountry, ':', {
      feeType: config.feeType,
      feeAmount: config.feeAmount
    });
    console.log('🔍 [FX] Cálculo fee BOB:', {
      inputAmount,
      clpAmount,
      feePercent,
      feeCLP,
      feeOriginAmount
    });

    const clpAmountWithFee = clpAmount + feeCLP;
    const finalAmount = clpAmount * clpToDestRate;

    // Tasa efectiva destino por 1 unidad origen (ej: COP por 1 BOB)
    const effectiveRate = manualExchangeRate * clpToDestRate;

    return res.json({
      ok: true,
      data: {
        originCurrency,
        originCountry: safeOriginCountry,
        destCurrency: priceData.code,
        amount: inputAmount,
        clpAmount: Number(clpAmount.toFixed(2)),
        fee: Number(feeCLP.toFixed(2)),
        feePercent: Number(feePercent.toFixed(2)),
        feeOriginAmount: Number(feeOriginAmount.toFixed(2)),
        clpAmountWithFee: Number(clpAmountWithFee.toFixed(2)),
        rateCLPToDest: clpToDestRate,
        manualExchangeRate,
        rate: Number(effectiveRate.toFixed(8)),
        receiveAmount: Number(finalAmount.toFixed(2)),
        currency: priceData.code
      }
    });

  } catch (error) {
    console.error('❌ [FX] Error crítico calculando:', error);
    res.status(500).json({ ok: false, error: 'Error interno de cálculo' });
  }
});

export default router;
