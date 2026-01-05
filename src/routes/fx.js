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
    const inputAmount = Number(amount);

    // 2) Encontrar tasa destino (flexible)
    const targetCode = destCountry.toUpperCase();
    const priceData = prices.find(p => {
      const pCode = p.code.toUpperCase();
      return pCode === targetCode || pCode === `${targetCode}P` || pCode.startsWith(targetCode);
    });

    // 🆕 IMPORTANTE: Primero comprobar si hay una Regla Manual (Override)
    // Esto evita que falle si Vita no tiene precios para "BO", pero nosotros sí lo soportamos manualmente.
    const originConfig = await TransactionConfig.findOne({ originCountry: safeOriginCountry });
    const destOverride = originConfig?.destinations?.find(d => d.countryCode === targetCode && d.isEnabled);

    // --- LOGICA MANUAL DE DESTINO (SPREAD MODEL) ---
    if (destOverride && destOverride.manualExchangeRate > 0) {
      console.log(`[FX] Usando tasa manual (Spread) para ${safeOriginCountry} -> ${targetCode}`);

      const manualExchangeRate = Number(destOverride.manualExchangeRate);
      const inputCLP = inputAmount;

      // 1. Margen
      let marginPercent = 0;
      if (destOverride.feeType === 'percentage') {
        marginPercent = (destOverride.feeAmount || 0) / 100;
      }

      // 2. Tasa Cliente
      const clientRate = manualExchangeRate * (1 - marginPercent);

      // 3. Monto Recibir Bruto
      const grossReceiveAmount = inputCLP * clientRate;

      // 4. Payout Fixed Fee
      const payoutFixedCost = Number(destOverride.payoutFixedFee || 0);
      const finalReceiveAmount = grossReceiveAmount - payoutFixedCost;

      // Mock currency for manual destinations if not known
      const destCurrency = targetCode === 'BO' ? 'BOB' : 'USD';

      return res.json({
        ok: true,
        data: {
          originCurrency,
          originCountry: safeOriginCountry,
          destCurrency,
          currency: destCurrency,
          amount: inputCLP,
          clpAmountWithFee: inputCLP,
          manualExchangeRate,
          rate: Number(clientRate.toFixed(8)),
          fee: 0,
          feePercent: Number((marginPercent * 100).toFixed(2)),
          payoutFixedCost: Number(payoutFixedCost.toFixed(2)),
          receiveAmount: Number(Math.max(0, finalReceiveAmount).toFixed(2)),
          isManual: true
        }
      });
    }

    // --- Si no hay manual override, buscamos precio oficial ---
    if (!priceData) {
      return res.status(404).json({ ok: false, error: `No hay tasa disponible para el país ${destCountry}` });
    }

    const clpToDestRate = Number(priceData.rate);

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

    // --- Caso 2: Origen Manual (BOB → CLP → Destino) ---
    // Si el origen NO es CLP, buscamos configuración manual
    if (originCurrency !== 'CLP') {
      console.log(`🔄 [FX] Detectado origen manual: ${originCurrency} (${safeOriginCountry})`);

      if (!originConfig || !originConfig.isEnabled || originConfig.provider !== 'internal_manual') {
        return res.status(400).json({
          ok: false,
          error: `El país de origen ${safeOriginCountry} no está habilitado para envíos manuales.`
        });
      }

      const manualRate = Number(originConfig.manualExchangeRate || 0);
      if (manualRate <= 0) {
        return res.status(500).json({
          ok: false,
          error: `No hay tasa de cambio configurada para ${originCurrency}.`
        });
      }

      // 1. Convertir monto origen a CLP (pivot)
      const clpAmount = inputAmount * manualRate;
      console.log(`💱 [FX] Conversión: ${inputAmount} ${originCurrency} × ${manualRate} = ${clpAmount} CLP`);

      // 2. Calcular comisión (sobre el monto origen)
      const feeType = originConfig.feeType || 'percent';
      const feeAmount = Number(originConfig.feeAmount || 0);

      let feeInOriginCurrency = 0;
      if (feeType === 'percent') {
        feeInOriginCurrency = inputAmount * (feeAmount / 100);
      } else if (feeType === 'fixed') {
        feeInOriginCurrency = feeAmount;
      }

      const totalOriginAmount = inputAmount + feeInOriginCurrency;
      console.log(`💰 [FX] Comisión: ${feeInOriginCurrency} ${originCurrency} (tipo: ${feeType})`);

      // 3. Convertir a Destino usando tasa Vita (CLP → Destino)
      const grossDestAmount = clpAmount * clpToDestRate;

      // 4. Descontar costo fijo de payout (en destino)
      const payoutFixedCost = Number(priceData.fixedCost || 0);
      const finalAmount = grossDestAmount - payoutFixedCost;

      console.log(`📤 [FX] Resultado: ${inputAmount} ${originCurrency} → ${clpAmount} CLP → ${finalAmount.toFixed(2)} ${priceData.code}`);

      // Calcular tasa efectiva BOB->Destino para mostrar al usuario
      const effectiveRate = payoutFixedCost > 0
        ? (finalAmount / inputAmount)  // Si hay fee fijo, calculamos la tasa real final
        : manualRate * clpToDestRate;   // Si no, es el producto de ambas tasas

      return res.json({
        ok: true,
        data: {
          // === CAMPOS ESPERADOS POR EL FRONTEND ===
          origin: originCurrency,              // BOB
          originCurrency: originCurrency,       // BOB
          destCurrency: priceData.code,        // COP
          currency: priceData.code,            // COP (legacy)

          // Montos principales
          amount: inputAmount,                 // 1,000 BOB (lo que ingresó el usuario)
          amountIn: totalOriginAmount,         // 1,030 BOB (con comisión)
          amountOut: Number(Math.max(0, finalAmount).toFixed(2)), // Monto final en COP
          receiveAmount: Number(Math.max(0, finalAmount).toFixed(2)), // Alias

          // Equivalente CLP (para backend/Vita)
          clpAmount: Number(clpAmount.toFixed(2)),

          // Tasas
          manualExchangeRate: manualRate,      // 140 (BOB->CLP)
          rate: clpToDestRate,                 // 4.343 (CLP->COP)
          rateWithMarkup: Number(effectiveRate.toFixed(4)), // Tasa efectiva BOB->COP para mostrar

          // Comisiones
          fee: Number(feeInOriginCurrency.toFixed(2)),
          feePercent: feeType === 'percent' ? feeAmount : 0,
          feeOriginAmount: Number(feeInOriginCurrency.toFixed(2)),

          // Costos
          payoutFixedCost: Number(payoutFixedCost.toFixed(2)),

          // Metadata
          provider: 'internal_manual',
          isManual: true
        }
      });
    }

    // Si llegamos aquí, hay un error de lógica
    return res.status(400).json({
      ok: false,
      error: 'Moneda de origen no soportada o no configurada correctamente.'
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
