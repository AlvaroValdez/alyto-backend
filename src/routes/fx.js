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

    // IMPORTANTE: El frontend SIEMPRE debe enviar originCountry explícitamente
    // Si no viene, intentamos deducirlo pero registramos advertencia
    let safeOriginCountry;

    if (!originCountry) {
      console.warn('⚠️ [FX] originCountry no fue enviado. El frontend debe enviarlo explícitamente.');
      // Fallback: deducir de SUPPORTED_ORIGINS por compatibilidad
      safeOriginCountry = (
        SUPPORTED_ORIGINS.find(o => o.currency === originCurrency)?.code || 'CL'
      ).toUpperCase();
      console.warn(`⚠️ [FX] Auto-deducido originCountry=${safeOriginCountry} desde currency=${originCurrency}`);
    } else {
      safeOriginCountry = originCountry.toUpperCase();
    }

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

      // 🆕 BUSCAR OVERRIDE MANUAL (Ej: Chile -> Bolivia)
      // Buscamos la config del país de ORIGEN (CL) para ver si tiene reglas para el DESTINO (BO)
      const originConfig = await TransactionConfig.findOne({ originCountry: safeOriginCountry });
      const destOverride = originConfig?.destinations?.find(d => d.countryCode === targetCode && d.isEnabled);

      if (destOverride && destOverride.manualExchangeRate > 0) {
        // --- LOGICA MANUAL DE DESTINO ---
        console.log(`[FX] Usando tasa manual para ${safeOriginCountry} -> ${targetCode}`);

        const manualRate = Number(destOverride.manualExchangeRate);

        // Calcular Comisión
        let feePercent = 0;
        let feeCLP = 0;

        if (destOverride.feeType === 'percentage') {
          feePercent = destOverride.feeAmount || 0;
          feeCLP = inputAmount * (feePercent / 100);
        } else if (destOverride.feeType === 'fixed') {
          feeCLP = destOverride.feeAmount || 0;
          feePercent = inputAmount > 0 ? (feeCLP / inputAmount) * 100 : 0;
        }

        const clpAmountWithFee = inputAmount + feeCLP;

        // Calcular Monto a Recibir
        // Formula: (Monto CLP * Tasa Manual) - FixedPayoutFee
        const payoutFixedCost = Number(destOverride.payoutFixedFee || 0);
        const finalAmount = (inputAmount * manualRate) - payoutFixedCost;

        return res.json({
          ok: true,
          data: {
            originCurrency,
            originCountry: safeOriginCountry,
            destCurrency: 'BOB', // Forzamos BOB si es Bolivia, o targetCode
            // Si targetCode es BO, currency es BOB. Si es otra cosa, usamos lo que sea.
            // Mejor usar priceData.code si disponible o mapa, pero targetCode es el país. 
            // Asumiremos BOB para BO.
            currency: targetCode === 'BO' ? 'BOB' : priceData?.code || 'USD',

            rate: manualRate,
            amount: inputAmount,
            fee: Number(feeCLP.toFixed(2)),
            feePercent: Number(feePercent.toFixed(2)),
            feeOriginAmount: Number(feeCLP.toFixed(2)),
            clpAmountWithFee: Number(clpAmountWithFee.toFixed(2)),

            payoutFixedCost: Number(payoutFixedCost.toFixed(2)),

            receiveAmount: Number(Math.max(0, finalAmount).toFixed(2)),
            isManual: true
          }
        });
      }

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

      // 🆕 Incluir fixed_cost de Vita en el cálculo del payout
      const payoutFixedCost = Number(priceData.fixedCost || 0);
      const finalAmount = (inputAmount * clpToDestRate) - payoutFixedCost;

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
          feeOriginAmount: Number(feeCLP.toFixed(2)),
          clpAmountWithFee: Number(clpAmountWithFee.toFixed(2)),

          // 🆕 Costos de payout (Vita withdrawal fee)
          payoutFixedCost: Number(payoutFixedCost.toFixed(2)),

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

    // 🆕 Incluir fixed_cost de Vita en el payout
    const payoutFixedCost = Number(priceData.fixedCost || 0);
    const finalAmount = (clpAmount * clpToDestRate) - payoutFixedCost;

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

        // 🆕 Costos de payout
        payoutFixedCost: Number(payoutFixedCost.toFixed(2)),

        receiveAmount: Number(finalAmount.toFixed(2)),
        currency: priceData.code
      }
    });

  } catch (error) {
    console.error('❌ [FX] Error crítico calculando:', error);
    res.status(500).json({ ok: false, error: 'Error interno de cálculo' });
  }
});

// GET /api/fx/payin-fees?country=CL&amount=2000
// Obtiene las comisiones de pay-in (Webpay, etc.) para mostrar al usuario
router.get('/payin-fees', async (req, res) => {
  try {
    const { country, amount } = req.query;

    if (!amount || !country) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required parameters: country, amount'
      });
    }

    // Obtener respuesta completa de Vita /prices
    const { client } = await import('../services/vitaClient.js');
    const vitaResponse = await client.get('/prices');
    const data = vitaResponse?.data || vitaResponse;

    // Extraer payin info para el país
    const payinCountry = String(country).toLowerCase();
    const payinInfo = data?.payins?.[payinCountry];

    if (!payinInfo) {
      return res.status(404).json({
        ok: false,
        error: `No payin information available for country ${country}`
      });
    }

    // Obtener método Webpay (o Fintoc como alternativa)
    const method = payinInfo.payment_methods?.find(m =>
      m.payment_method === 'Webpay' || m.payment_method === 'Fintoc'
    );

    if (!method) {
      return res.status(404).json({
        ok: false,
        error: 'No payment method available for this country'
      });
    }

    const inputAmount = Number(amount);
    const sellPrice = Number(method.sell_price);
    const fixedCost = Number(method.fixed_cost);

    // Cálculo real de lo que recibirás en tu wallet
    const receivedInWallet = (inputAmount * sellPrice) - fixedCost;
    const totalFee = inputAmount - receivedInWallet;
    const feePercent = inputAmount > 0 ? (totalFee / inputAmount) * 100 : 0;

    return res.json({
      ok: true,
      data: {
        paymentMethod: method.payment_method,
        amountToPay: inputAmount,
        sellPrice,
        fixedCost,
        receivedInWallet: Number(receivedInWallet.toFixed(2)),
        totalFee: Number(totalFee.toFixed(2)),
        feePercent: Number(feePercent.toFixed(2))
      }
    });

  } catch (error) {
    console.error('[FX] Error getting payin fees:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

export default router;
