import { Router } from 'express';
import { getListPrices } from '../services/vitaService.js';
import TransactionConfig from '../models/TransactionConfig.js';
import { SUPPORTED_ORIGINS } from '../data/supportedOrigins.js';

const router = Router();

/**
 * Helper: Calcula el monto neto que llegará al wallet después de fees de pasarela
 * NUEVO: Usa fees de Fintoc Directo en lugar de Vita Payment Orders
 * @param {string} country - Código del país (ej: 'CL')
 * @param {number} amount - Monto bruto que el usuario paga
 * @returns {Promise<object>} Desglose de fees
 */
async function getPayinFeeBreakdown(country, amount) {
  try {
    // 💰 MODELO HÍBRIDO: Usar fees de Fintoc Directo
    // Ya no obtenemos fees desde Vita /prices porque usamos nuestro propio Fintoc
    const { getFintocFees } = await import('../services/fintocService.js');

    const fintocFees = getFintocFees();
    const inputAmount = Number(amount);

    // Fees de Fintoc (más bajos que Vita)
    const feePercent = fintocFees.percent; // ~1.49% (vs ~3-4% de Vita)
    const fixedCost = fintocFees.fixed;    // ~$150 CLP (vs ~$300 de Vita)

    // Cálculo: Fee total = (amount * percent/100) + fixed
    const percentFee = (inputAmount * feePercent) / 100;
    const totalFee = percentFee + fixedCost;
    const netAmount = inputAmount - totalFee;

    console.log(`💳 [FX-Fintoc] Payin fees: ${feePercent}% + $${fixedCost} = $${totalFee.toFixed(2)} (Net: $${netAmount.toFixed(2)})`);

    return {
      available: true,
      paymentMethod: 'Fintoc Direct',
      grossAmount: inputAmount,
      sellPrice: 1, // Fintoc no usa sell_price, es directo
      fixedCost,
      netAmount: Number(netAmount.toFixed(2)),
      totalFee: Number(totalFee.toFixed(2)),
      feePercent: Number(feePercent.toFixed(2))
    };

  } catch (error) {
    console.error('[FX] Error calculating Fintoc fees:', error.message);
    // En caso de error, usar valores conservadores (fees de Vita como fallback)
    const inputAmount = Number(amount);
    const fallbackFeePercent = 3.0; // Fallback conservador
    const fallbackFixed = 300;
    const fallbackTotalFee = (inputAmount * fallbackFeePercent / 100) + fallbackFixed;

    return {
      available: false,
      grossAmount: inputAmount,
      netAmount: inputAmount - fallbackTotalFee,
      totalFee: fallbackTotalFee,
      feePercent: fallbackFeePercent,
      sellPrice: 1,
      fixedCost: fallbackFixed,
      paymentMethod: 'Fallback',
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

    if (!isFinite(inputAmount) || inputAmount <= 0) {
      return res.status(400).json({ ok: false, error: 'El monto debe ser un número positivo' });
    }

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
      console.log(`[FX] Usando tasa manual (Spread) para ${safeOriginCountry} -> ${targetCode}, mode=${mode}`);

      const manualExchangeRate = Number(destOverride.manualExchangeRate);

      // 1. Margen
      let marginPercent = 0;
      if (destOverride.feeType === 'percentage') {
        marginPercent = (destOverride.feeAmount || 0) / 100;
      }

      // 2. Tasa Cliente (con margen incluido)
      const clientRate = manualExchangeRate * (1 - marginPercent);

      // 4. Payout Fixed Fee
      const payoutFixedCost = Number(destOverride.payoutFixedFee || 0);

      // 3. Cálculo bidireccional
      let inputCLP, grossReceiveAmount, finalReceiveAmount;
      if (mode === 'receive') {
        // MODO INVERSO: usuario dice cuánto quiere que reciban
        finalReceiveAmount = inputAmount;
        grossReceiveAmount = finalReceiveAmount + payoutFixedCost;
        inputCLP = grossReceiveAmount / clientRate;
      } else {
        inputCLP = inputAmount;
        grossReceiveAmount = inputCLP * clientRate;
        finalReceiveAmount = grossReceiveAmount - payoutFixedCost;
      }

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
      const inputIsOrigin = mode === 'send';
      const destCurrency = priceData.code;
      console.log(`📄 [FX-QUOTE] Modo: ${mode}, Input: ${inputAmount} ${inputIsOrigin ? 'CLP (origen)' : destCurrency + ' (destino)'}`);

      // 💳 Obtener fees de Fintoc dinámicos desde config
      const TransactionConfig = (await import('../models/TransactionConfig.js')).default;
      const config = await TransactionConfig.findOne({ originCountry: safeOriginCountry });
      const fintocConfig = config?.fintocConfig || { ufValue: 37500, tier: 1 };

      const { calculateFintocFee } = await import('../utils/fintocFees.js');
      // fixedFee es constante (depende del tier/UF, NO del monto)
      const { fixedFee: fintocFixedFee } = calculateFintocFee(10000, fintocConfig);

      // Se recalcula tras la lógica bidireccional; inicializamos con valores send-mode
      let payinFee = {
        grossAmount: inputAmount,
        totalFee: fintocFixedFee,
        netAmount: inputAmount - fintocFixedFee,
        feePercent: inputAmount > 0 ? (fintocFixedFee / inputAmount) * 100 : 0
      };

      console.log(`💳 [FX-PAYIN] Gross: ${payinFee.grossAmount}, Fee: ${payinFee.totalFee} CLP (${payinFee.feePercent.toFixed(2)}%), Net: ${payinFee.netAmount}`);
      console.log(`💳 [FX-FINTOC] Config: UF=${fintocConfig.ufValue}, Tier=${fintocConfig.tier}, Fixed Fee=${fintocFixedFee} CLP`);

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

      //--- CALCULADORA BIDIRECCIONAL CON SPREAD ---
      let principal = 0;           // CLP neto (después de payin fees)
      let destReceiveAmount = 0;   // Monto que recibe el cliente
      let destGrossAmount = 0;     // Monto bruto destino (antes de payout fixed cost)
      let profitCOP = 0;           // Ganancia en moneda destino
      let grossOriginAmount = 0;   // CLP bruto que paga el usuario (incluye payin fee)

      if (mode === 'receive') {
        // MODO INVERSO: usuario dice cuánto quiere que reciban
        destReceiveAmount = inputAmount;
        destGrossAmount = destReceiveAmount + payoutFixedCost;

        // Principal neto necesario (antes de payin fee)
        principal = destGrossAmount / alytoRate;

        // Revertir payin fee: fee es fijo en CLP, por lo que grossCLP = principal + fixedFee
        grossOriginAmount = principal + fintocFixedFee;

        // Actualizar payinFee con los valores correctos
        payinFee = {
          grossAmount: grossOriginAmount,
          totalFee: fintocFixedFee,
          netAmount: principal,
          feePercent: grossOriginAmount > 0 ? (fintocFixedFee / grossOriginAmount) * 100 : 0
        };

        const vitaGrossAmount = principal * vitaRate;
        profitCOP = vitaGrossAmount - destGrossAmount;

      } else {
        // MODO NORMAL: usuario dice cuánto envía (bruto en CLP)
        grossOriginAmount = inputAmount;
        principal = payinFee.netAmount; // = inputAmount - fintocFixedFee

        destGrossAmount = principal * alytoRate;
        destReceiveAmount = destGrossAmount - payoutFixedCost;

        const vitaGrossAmount = principal * vitaRate;
        profitCOP = vitaGrossAmount - destGrossAmount;
      }

      const profitCLP = profitCOP / vitaRate;

      console.log(`💰 [FX-SPREAD-RESULT] Mode: ${mode}, GrossOrigin: ${grossOriginAmount.toFixed(2)} CLP, Net: ${principal.toFixed(2)} CLP, Receive: ${destReceiveAmount.toFixed(2)} ${destCurrency}`);
      console.log(`💰 [FX-SPREAD-PROFIT] Profit: ${profitCOP.toFixed(2)} ${destCurrency} (~${profitCLP.toFixed(2)} CLP)`);

      // 🎯 TASA EFECTIVA TODO INCLUIDO: CLP bruto por cada 1 unidad destino
      const effectiveAllInclusiveRate = grossOriginAmount / destReceiveAmount;
      console.log(`📊 [FX-EFFECTIVE-RATE] All-inclusive: ${effectiveAllInclusiveRate.toFixed(4)} ${originCurrency}/${priceData.code}`);

      return res.json({
        ok: true,
        data: {
          originCurrency,
          originCountry: safeOriginCountry,
          destCurrency: priceData.code,

          // 🎯 Tasa TODO INCLUIDO que ve el cliente (absorbe fees de pasarela + spread + costos)
          rate: Number(effectiveAllInclusiveRate.toFixed(4)),

          // Montos cliente
          amount: Number(grossOriginAmount.toFixed(2)),           // CLP bruto que paga el usuario
          clpAmountWithFee: Number(grossOriginAmount.toFixed(2)), // Total que paga
          receiveAmount: Number(Math.max(0, destReceiveAmount).toFixed(2)),
          amountOut: Number(Math.max(0, destReceiveAmount).toFixed(2)), // Alias for consistency

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
            originPrincipal: Number(principal.toFixed(2)),         // Neto después de payin
            originFee: payinFee.totalFee,                        // Fee de pasarela
            originTotal: Number(grossOriginAmount.toFixed(2)),   // Bruto que paga

            destCurrency: priceData.code,
            destGrossAmount: Number(destGrossAmount.toFixed(2)),
            destVitaFixedCost: Number(payoutFixedCost.toFixed(2)),
            destReceiveAmount: Number(Math.max(0, destReceiveAmount).toFixed(2)),

            profitOriginCurrency: Number(profitCLP.toFixed(2)), // Profit in CLP (pivot currency), NOT origin currency
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
      const feeType = originConfig.feeType || 'percentage';
      const feeAmount = Number(originConfig.feeAmount || 0);

      let adjustedRate = manualRate;

      if (feeType === 'percentage' && feeAmount > 0) {
        // Si la tasa base es 140 CLP/BOB y queremos 3% de margen:
        // El usuario recibe MENOS CLP por su BOB
        // Tasa ajustada = 140 × (1 - 0.03) = 135.8 CLP/BOB
        adjustedRate = manualRate * (1 - feeAmount / 100);
      } else if (feeType === 'fixed' && feeAmount > 0) {
        // Para fee fijo, lo restamos del resultado CLP
        // (Se manejará después de la conversión)
      }

      const payoutFixedCost = Number(priceData.fixedCost || 0);

      // Variables bidireccionales
      let totalOriginAmount, clpAmount, finalCLP, grossDestAmount, finalAmount, ourMarginCLP;

      if (mode === 'receive') {
        // MODO INVERSO: usuario dice cuánto quiere que reciban en destino
        finalAmount = inputAmount;
        grossDestAmount = finalAmount + payoutFixedCost;

        // Paso 2 inverso: destino → CLP
        finalCLP = grossDestAmount / clpToDestRate;

        // Paso 1 inverso: CLP → origen
        let clpBeforeFee = finalCLP;
        if (feeType === 'fixed' && feeAmount > 0) {
          clpBeforeFee = finalCLP + feeAmount;
        }
        clpAmount = clpBeforeFee;
        totalOriginAmount = clpAmount / adjustedRate;
        ourMarginCLP = (manualRate - adjustedRate) * totalOriginAmount;

      } else {
        // MODO NORMAL: usuario dice cuánto envía
        totalOriginAmount = inputAmount;

        // Paso 1: origen → CLP
        clpAmount = inputAmount * adjustedRate;
        ourMarginCLP = (manualRate - adjustedRate) * inputAmount;

        // Paso 2: aplicar fee fijo si corresponde
        finalCLP = clpAmount;
        if (feeType === 'fixed' && feeAmount > 0) {
          finalCLP = clpAmount - feeAmount;
        }

        // Paso 3: CLP → destino
        grossDestAmount = finalCLP * clpToDestRate;
        finalAmount = grossDestAmount - payoutFixedCost;
      }

      console.log(`\n📊 [FX] RESUMEN FINAL (mode=${mode}):`);
      console.log(`├─ Usuario envía: ${totalOriginAmount.toFixed(4)} ${originCurrency}`);
      console.log(`├─ CLP equivalente: ${clpAmount.toFixed(2)} (ajustado con margen)`);
      console.log(`├─ CLP final: ${finalCLP.toFixed(2)}`);
      console.log(`├─ Margen Alyto: ${ourMarginCLP.toFixed(2)} CLP`);
      console.log(`├─ Bruto destino: ${grossDestAmount.toFixed(2)} ${priceData.code}`);
      console.log(`├─ Costo payout: ${payoutFixedCost.toFixed(2)} ${priceData.code}`);
      console.log(`└─ Usuario recibe: ${finalAmount.toFixed(2)} ${priceData.code}\n`);

      // Calcular tasa efectiva BOB→Destino para mostrar al usuario
      const effectiveRate = totalOriginAmount > 0 ? finalAmount / totalOriginAmount : 0;

      return res.json({
        ok: true,
        data: {
          // === CAMPOS ESPERADOS POR EL FRONTEND ===
          origin: originCurrency,              // BOB
          originCurrency: originCurrency,       // BOB
          destCurrency: priceData.code,        // COP
          currency: priceData.code,            // COP (legacy)

          // Montos principales
          amount: Number(totalOriginAmount.toFixed(4)),        // BOB que paga el usuario
          amountIn: Number(totalOriginAmount.toFixed(4)),      // BOB que paga el usuario
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
            // Paso 1: Origen → CLP
            originToClpBase: Number(manualRate.toFixed(4)),         // Tasa base sin margen
            originToClpRate: Number(adjustedRate.toFixed(4)),       // Tasa con margen aplicado
            marginPercent: Number(feeAmount.toFixed(2)),            // % de margen/fee
            marginCLP: Number(ourMarginCLP.toFixed(2)),             // Margen en CLP

            // Paso 2: CLP → Destino
            vitaRate: Number(clpToDestRate.toFixed(4)),              // CLP→COP rate from Vita

            // Tasa efectiva final: Origen → Destino
            alytoRate: Number(effectiveRate.toFixed(4)),            // BOB→COP effective rate

            // Profit
            spreadPercent: Number(feeAmount.toFixed(2)),            // Our margin %
            profitDestCurrency: Number((ourMarginCLP * clpToDestRate).toFixed(2)), // Profit in dest currency
            profitOriginCurrency: Number(ourMarginCLP.toFixed(2))   // Profit in CLP
          },

          amountsTracking: {
            originCurrency: originCurrency,                           // BOB
            originPrincipal: Number(totalOriginAmount.toFixed(4)),   // BOB que paga
            originFee: 0,                                             // No visible fee
            originTotal: Number(totalOriginAmount.toFixed(4)),        // BOB que paga

            destCurrency: priceData.code,                            // COP
            destGrossAmount: Number(grossDestAmount.toFixed(2)),     // Before payout cost
            destVitaFixedCost: Number(payoutFixedCost.toFixed(2)),   // Vita's fixed cost
            destReceiveAmount: Number(Math.max(0, finalAmount).toFixed(2)), // Final amount

            profitOriginCurrency: Number(ourMarginCLP.toFixed(2)),   // Profit in CLP (pivot currency), NOT origin currency
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
