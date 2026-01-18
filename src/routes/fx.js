import { Router } from 'express';
import { getListPrices } from '../services/vitaService.js';
import TransactionConfig from '../models/TransactionConfig.js';
import { SUPPORTED_ORIGINS } from '../data/supportedOrigins.js';

const router = Router();

/**
 * Helper: Calcula el monto neto que llegará al wallet después de fees de pasarela
 * @param {string} country - Código del país (ej: 'CL')
 * @param {number} amount - Monto bruto que el usuario paga
 * @returns {Promise<object>} Desglose de fees
 */
async function getPayinFeeBreakdown(country, amount) {
  try {
    const { client } = await import('../services/vitaClient.js');
    const vitaResponse = await client.get('/prices');
    const data = vitaResponse?.data || vitaResponse;

    const payinCountry = String(country).toLowerCase();
    const payinInfo = data?.payins?.[payinCountry];

    if (!payinInfo) {
      // Si no hay info de payin, asumimos que no hay fees (para países sin pasarela)
      return {
        available: false,
        grossAmount: amount,
        netAmount: amount,
        totalFee: 0,
        feePercent: 0,
        sellPrice: 1,
        fixedCost: 0,
        paymentMethod: 'N/A'
      };
    }

    // Buscar método Webpay o Fintoc
    const method = payinInfo.payment_methods?.find(m =>
      m.payment_method === 'Webpay' || m.payment_method === 'Fintoc'
    );

    if (!method) {
      return {
        available: false,
        grossAmount: amount,
        netAmount: amount,
        totalFee: 0,
        feePercent: 0,
        sellPrice: 1,
        fixedCost: 0,
        paymentMethod: 'N/A'
      };
    }

    const inputAmount = Number(amount);
    const sellPrice = Number(method.sell_price);
    const fixedCost = Number(method.fixed_cost);

    // Cálculo real de lo que recibirás en tu wallet
    const netAmount = (inputAmount * sellPrice) - fixedCost;
    const totalFee = inputAmount - netAmount;
    const feePercent = inputAmount > 0 ? (totalFee / inputAmount) * 100 : 0;

    return {
      available: true,
      paymentMethod: method.payment_method,
      grossAmount: inputAmount,
      sellPrice,
      fixedCost,
      netAmount: Number(netAmount.toFixed(2)),
      totalFee: Number(totalFee.toFixed(2)),
      feePercent: Number(feePercent.toFixed(2))
    };
  } catch (error) {
    console.error('[FX] Error calculating payin fees:', error.message);
    // En caso de error, asumimos sin fees para no bloquear la cotización
    return {
      available: false,
      grossAmount: amount,
      netAmount: amount,
      totalFee: 0,
      feePercent: 0,
      sellPrice: 1,
      fixedCost: 0,
      paymentMethod: 'N/A',
      error: error.message
    };
  }
}

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

      // 2. Tasa Cliente (con margen incluido)
      const clientRate = manualExchangeRate * (1 - marginPercent);

      // 3. Monto Recibir Bruto (lo que se envía al beneficiario antes de fees)
      const grossReceiveAmount = inputCLP * clientRate;

      // 4. Payout Fixed Fee
      const payoutFixedCost = Number(destOverride.payoutFixedFee || 0);
      const finalReceiveAmount = grossReceiveAmount - payoutFixedCost;

      // 5. Calcular Ganancia (Profit)
      // La ganancia es la diferencia entre la tasa base y la tasa con margen
      const profitPerUnit = manualExchangeRate - clientRate;
      const totalProfitInDestCurrency = profitPerUnit * inputCLP;

      // Mock currency for manual destinations if not known
      const destCurrency = targetCode === 'BO' ? 'BOB' :
        targetCode === 'CO' ? 'COP' :
          targetCode === 'PE' ? 'PEN' : 'USD';

      console.log(`💰 [FX-MANUAL-DEST] Profit: ${totalProfitInDestCurrency.toFixed(2)} ${destCurrency} (${(marginPercent * 100).toFixed(2)}% margin)`);

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
          isManual: true,

          // 📊 Tracking Data (para guardar en Transaction)
          rateTracking: {
            vitaRate: Number(manualExchangeRate.toFixed(4)),     // Tasa base manual
            alytoRate: Number(clientRate.toFixed(4)),            // Tasa con margen
            destAmount: Number(Math.max(0, finalReceiveAmount).toFixed(2)),
            destCurrency: destCurrency,
            spreadPercent: Number((marginPercent * 100).toFixed(2)),
            profitDestCurrency: Number(totalProfitInDestCurrency.toFixed(2))
          },

          amountsTracking: {
            originCurrency: originCurrency,
            originPrincipal: Number(inputCLP.toFixed(2)),
            originFee: 0,
            originTotal: Number(inputCLP.toFixed(2)),

            destCurrency: destCurrency,
            destGrossAmount: Number(grossReceiveAmount.toFixed(2)),
            destVitaFixedCost: Number(payoutFixedCost.toFixed(2)),
            destReceiveAmount: Number(Math.max(0, finalReceiveAmount).toFixed(2)),

            profitOriginCurrency: 0,  // Not applicable for this flow
            profitDestCurrency: Number(totalProfitInDestCurrency.toFixed(2))
          },

          feeAudit: {
            markupSource: 'manual_destination',
            markupId: destOverride._id || originConfig?._id,
            appliedAt: new Date()
          }
        }
      });
    }

    // --- Si no hay manual override, buscamos precio oficial ---
    if (!priceData) {
      return res.status(404).json({ ok: false, error: `No hay tasa disponible para el país ${destCountry}` });
    }

    const clpToDestRate = Number(priceData.rate);

    // --- Caso 1: Origen CLP (flujo spread) ---
    if (originCurrency === 'CLP') {
      // 🔍 NUEVO: Calcular fees de pasarela (Payin)
      const payinFee = await getPayinFeeBreakdown(safeOriginCountry, inputAmount);
      console.log(`💳 [FX-PAYIN] Gross: ${payinFee.grossAmount}, Fee: ${payinFee.totalFee} (${payinFee.feePercent}%), Net: ${payinFee.netAmount}`);

      // 💰 Obtener spread desde Markup (con lógica priorizada)
      const Markup = (await import('../models/Markup.js')).default;

      // 1. Buscar markup específico origen→destino
      let markup = await Markup.findOne({
        originCountry: safeOriginCountry,
        destCountry: targetCode
      });

      // 2. Buscar default para país origen
      if (!markup) {
        markup = await Markup.findOne({
          originCountry: safeOriginCountry,
          destCountry: { $exists: false }
        });
      }

      // 3. Global default
      if (!markup) {
        markup = await Markup.findOne({ isDefault: true });
      }

      const spreadPercent = markup?.percent || 2.0;
      const markupSource = markup ? (markup.destCountry ? 'country-specific' : 'default') : 'default';
      const markupId = markup?._id;

      // Tasa real de Vita
      const vitaRate = clpToDestRate;

      // Aplicar spread: Alyto rate = Vita rate * (1 - spread%)
      const alytoRate = vitaRate * (1 - spreadPercent / 100);

      const payoutFixedCost = Number(priceData.fixedCost || 0);

      console.log(`🔧 [FX-SPREAD] Vita: ${vitaRate.toFixed(4)}, Spread: ${spreadPercent}%, Alyto: ${alytoRate.toFixed(4)}`);

      //--- CALCULADORA BIDIRECCIONAL CON SPREAD (AHORA SOBRE MONTO NETO) ---
      let principal = 0;           // Monto en CLP (NETO después de payin fees)
      let destReceiveAmount = 0;   // Monto que recibe el cliente
      let destGrossAmount = 0;     // Monto bruto (antes de costo Vita)
      let profitCOP = 0;           // Ganancia en COP

      if (mode === 'receive') {
        // MODO INVERSO: Usuario dice cuánto quiere que reciban
        destReceiveAmount = inputAmount;

        // Calcular cantidad bruta necesaria (antes de fixed cost)
        destGrossAmount = destReceiveAmount + payoutFixedCost;

        // Calcular principal NETO usando tasa Alyto (con spread)
        principal = destGrossAmount / alytoRate;

        // Calcular lo que enviaríamos con tasa real Vita
        const vitaGrossAmount = principal * vitaRate;
        profitCOP = vitaGrossAmount - destGrossAmount;

      } else {
        // MODO NORMAL: Usuario dice cuánto envía (BRUTO)
        // CRÍTICO: Usar monto NETO (después de payin fees) para cálculos
        principal = payinFee.netAmount;

        // Con tasa Alyto (cliente ve)
        destGrossAmount = principal * alytoRate;
        destReceiveAmount = destGrossAmount - payoutFixedCost;

        // Con tasa Vita (real)
        const vitaGrossAmount = principal * vitaRate;
        profitCOP = vitaGrossAmount - destGrossAmount;
      }

      const profitCLP = profitCOP / vitaRate; // Aproximado

      console.log(`💰 [FX-SPREAD-RESULT] Gross: ${inputAmount} CLP, Net: ${principal.toFixed(2)} CLP, Receive: ${destReceiveAmount.toFixed(2)} COP`);
      console.log(`💰 [FX-SPREAD-PROFIT] Profit: ${profitCOP.toFixed(2)} COP (~${profitCLP.toFixed(2)} CLP retained)`);

      // 🎯 TASA EFECTIVA TODO INCLUIDO (absorbe fees de pasarela)
      // Esta es la tasa que el cliente ve: Cuánto CLP cuesta enviar 1 unidad de destino
      // Incluye: Fees de pasarela + Spread de Alyto + Costos Vita
      const effectiveAllInclusiveRate = inputAmount / destReceiveAmount; // CLP por cada 1 COP
      console.log(`📊 [FX-EFFECTIVE-RATE] All-inclusive: ${effectiveAllInclusiveRate.toFixed(4)} ${originCurrency}/${priceData.code} (absorbe todos los costos)`);

      return res.json({
        ok: true,
        data: {
          originCurrency,
          originCountry: safeOriginCountry,
          destCurrency: priceData.code,

          // 🎯 Tasa TODO INCLUIDO que ve el cliente (absorbe fees de pasarela + spread + costos)
          rate: Number(effectiveAllInclusiveRate.toFixed(4)),

          // Montos cliente (BRUTO)
          amount: Number(inputAmount.toFixed(2)),           // Monto que paga el usuario
          clpAmountWithFee: Number(inputAmount.toFixed(2)), // Total que paga
          receiveAmount: Number(Math.max(0, destReceiveAmount).toFixed(2)),

          // 🆕 DESGLOSE DE FEES DE PASARELA (Payin)
          payinFeeBreakdown: {
            available: payinFee.available,
            paymentMethod: payinFee.paymentMethod,
            grossAmount: payinFee.grossAmount,
            totalFee: payinFee.totalFee,
            feePercent: payinFee.feePercent,
            netAmount: payinFee.netAmount,
            sellPrice: payinFee.sellPrice,
            fixedCost: payinFee.fixedCost
          },

          // Legacy fields (para compatibilidad)
          fee: payinFee.totalFee,
          feePercent: payinFee.feePercent,
          feeOriginAmount: payinFee.totalFee,

          payoutFixedCost: Number(payoutFixedCost.toFixed(2)),
          currency: priceData.code,

          // Tracking data (para guardar en Transaction)
          rateTracking: {
            vitaRate: Number(vitaRate.toFixed(4)),
            alytoRate: Number(alytoRate.toFixed(4)),
            spreadPercent: Number(spreadPercent.toFixed(2)),
            profitDestCurrency: Number(profitCOP.toFixed(2))
          },

          amountsTracking: {
            originCurrency,
            originPrincipal: Number(principal.toFixed(2)),      // Neto después de payin
            originFee: payinFee.totalFee,                       // Fee de pasarela
            originTotal: Number(inputAmount.toFixed(2)),        // Bruto que paga

            destCurrency: priceData.code,
            destGrossAmount: Number(destGrossAmount.toFixed(2)),
            destVitaFixedCost: Number(payoutFixedCost.toFixed(2)),
            destReceiveAmount: Number(Math.max(0, destReceiveAmount).toFixed(2)),

            profitOriginCurrency: Number(profitCLP.toFixed(2)),
            profitDestCurrency: Number(profitCOP.toFixed(2))
          },

          feeAudit: {
            markupSource,
            markupId,
            appliedAt: new Date(),
            payinFeeDetected: payinFee.available
          }
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
          feeIncludedInRate: true,  // Flag para que el frontend sepa que el fee está incluido

          // 📊 Tracking Data (para guardar en Transaction)
          rateTracking: {
            vitaRate: Number(clpToDestRate.toFixed(4)),              // CLP→COP rate from Vita
            alytoRate: Number(effectiveRate.toFixed(4)),            // BOB→COP effective rate
            spreadPercent: Number(feeAmount.toFixed(2)),            // Our margin %
            profitDestCurrency: Number((ourMarginCLP * clpToDestRate).toFixed(2)) // Profit in dest currency
          },

          amountsTracking: {
            originCurrency: originCurrency,                          // BOB
            originPrincipal: Number(inputAmount.toFixed(2)),         // 1,000 BOB
            originFee: 0,                                            // No visible fee
            originTotal: Number(totalOriginAmount.toFixed(2)),       // 1,000 BOB

            destCurrency: priceData.code,                            // COP
            destGrossAmount: Number(grossDestAmount.toFixed(2)),     // Before payout cost
            destVitaFixedCost: Number(payoutFixedCost.toFixed(2)),   // Vita's fixed cost
            destReceiveAmount: Number(Math.max(0, finalAmount).toFixed(2)), // Final amount

            profitOriginCurrency: Number(ourMarginCLP.toFixed(2)),   // Profit in CLP
            profitDestCurrency: Number((ourMarginCLP * clpToDestRate).toFixed(2)) // Profit in COP
          },

          feeAudit: {
            markupSource: 'manual',
            markupId: originConfig._id || null,
            appliedAt: new Date()
          }
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
