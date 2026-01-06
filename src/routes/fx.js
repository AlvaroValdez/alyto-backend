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
    const { amount, destCountry, origin, originCountry, mode = 'send' } = req.query;

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
      const payoutFixedCost = Number(priceData.fixedCost || 0);

      // --- CALCULADORA BIDIRECCIONAL ---
      let principal = 0;        // Monto base en CLP (sin comisión)
      let receiveAmount = 0;    // Monto final que recibe el destinatario
      let feeCLP = 0;           // Comisión en CLP
      let totalToPay = 0;       // Total que paga el usuario

      if (mode === 'receive') {
        // MODO INVERSO: Usuario dice cuánto quiere que reciban
        receiveAmount = inputAmount;

        // Calcular principal necesario desde el monto a recibir
        // receiveAmount = (principal * rate) - fixedCost
        // => principal = (receiveAmount + fixedCost) / rate
        principal = (receiveAmount + payoutFixedCost) / clpToDestRate;

        // Calcular comisión sobre el principal
        feeCLP = principal * (feePercent / 100);

        // Total a pagar = principal + comisión
        totalToPay = principal + feeCLP;

      } else {
        // MODO NORMAL: Usuario dice cuánto envía (principal)
        principal = inputAmount;

        // Calcular comisión
        feeCLP = principal * (feePercent / 100);

        // Total a pagar
        totalToPay = principal + feeCLP;

        // Calcular cuánto recibe el destinatario
        // receiveAmount = (principal * rate) - fixedCost
        const grossDestAmount = principal * clpToDestRate;
        receiveAmount = grossDestAmount - payoutFixedCost;
      }

      console.log(`💰 [FX-RESULT] Principal: ${principal.toFixed(2)}, Fee: ${feeCLP.toFixed(2)}, Total: ${totalToPay.toFixed(2)}, Receive: ${receiveAmount.toFixed(2)}`);

      return res.json({
        ok: true,
        data: {
          originCurrency,
          originCountry: safeOriginCountry,
          destCurrency: priceData.code,
          rate: clpToDestRate,

          amount: Number(principal.toFixed(2)),                    // Principal (sin comisión)
          clpAmountWithFee: Number(totalToPay.toFixed(2)),        // Total con comisión

          fee: Number(feeCLP.toFixed(2)),
          feePercent: Number(feePercent.toFixed(2)),
          feeOriginAmount: Number(feeCLP.toFixed(2)),

          payoutFixedCost: Number(payoutFixedCost.toFixed(2)),

          receiveAmount: Number(Math.max(0, receiveAmount).toFixed(2)),
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

      // 🔧 NUEVO MODELO: Comisión incluida en la tasa
      // En lugar de cobrar fee separado, ajustamos la tasa para incluir nuestro margen
      const feeType = originConfig.feeType || 'percent';
      const feeAmount = Number(originConfig.feeAmount || 0);

      let adjustedRate = manualRate;

      if (feeType === 'percent' && feeAmount > 0) {
        // Si la tasa base es 140 CLP/BOB y queremos 3% de margen:
        // El usuario recibe MENOS CLP por su BOB
        // Tasa ajustada = 140 × (1 - 0.03) = 135.8 CLP/BOB
        adjustedRate = manualRate * (1 - feeAmount / 100);
      } else if (feeType === 'fixed' && feeAmount > 0) {
        // Para fee fijo, lo restamos del resultado CLP
        // (Se manejará después de la conversión)
      }

      // 1. Convertir monto origen a CLP (pivot) usando tasa ajustada
      const clpAmount = inputAmount * adjustedRate;
      console.log(`💱 [FX] Conversión: ${inputAmount} ${originCurrency} × ${adjustedRate.toFixed(4)} (con margen) = ${clpAmount.toFixed(2)} CLP`);
      console.log(`📊 [FX] Tasa base: ${manualRate}, Margen: ${feeAmount}%, Tasa final: ${adjustedRate.toFixed(4)}`);

      // 2. NO cobramos fee adicional - el usuario paga exactamente lo que ingresó
      const totalOriginAmount = inputAmount;

      // Para efectos internos, calculamos cuánto es nuestro margen (en CLP)
      const ourMarginCLP = (manualRate - adjustedRate) * inputAmount;
      console.log(`💰 [FX] Margen Alyto: ${ourMarginCLP.toFixed(2)} CLP (oculto en la tasa)`);

      // 3. Si hay fee fijo, lo descontamos del CLP
      let finalCLP = clpAmount;
      if (feeType === 'fixed' && feeAmount > 0) {
        finalCLP = clpAmount - feeAmount;
        console.log(`💸 [FX] Fee fijo descontado: ${feeAmount} CLP`);
      }

      // 4. Convertir a Destino usando tasa Vita (CLP → Destino)
      const grossDestAmount = finalCLP * clpToDestRate;

      // 5. Descontar costo fijo de payout (en destino)
      const payoutFixedCost = Number(priceData.fixedCost || 0);
      const finalAmount = grossDestAmount - payoutFixedCost;

      console.log(`📤 [FX] Resultado: ${inputAmount} ${originCurrency} → ${finalCLP.toFixed(2)} CLP → ${finalAmount.toFixed(2)} ${priceData.code}`);

      // Calcular tasa efectiva BOB→Destino para mostrar al usuario
      const effectiveRate = finalAmount / inputAmount;

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
          amountIn: totalOriginAmount,         // 1,000 BOB (SIN fee adicional visible)
          amountOut: Number(Math.max(0, finalAmount).toFixed(2)), // Monto final en COP
          receiveAmount: Number(Math.max(0, finalAmount).toFixed(2)), // Alias

          // Equivalente CLP (para backend/Vita)
          clpAmount: Number(finalCLP.toFixed(2)),

          // Tasas
          manualExchangeRate: adjustedRate,    // Tasa ajustada (con margen incluido)
          rate: clpToDestRate,                 // 4.343 (CLP→COP)
          rateWithMarkup: Number(effectiveRate.toFixed(4)), // Tasa efectiva BOB→COP

          // Comisiones (ocultas, para internal tracking)
          fee: 0,  // NO mostramos fee separado
          feePercent: 0,  // NO mostramos porcentaje
          feeOriginAmount: 0,

          // Costos
          payoutFixedCost: Number(payoutFixedCost.toFixed(2)),

          // Metadata
          provider: 'internal_manual',
          isManual: true,
          feeIncludedInRate: true  // Flag para que el frontend sepa que el fee está incluido
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
