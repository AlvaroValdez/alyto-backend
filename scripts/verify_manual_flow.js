
import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Fix path for dotenv
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

const API_URL = 'http://localhost:5000/api';
/**
 * Script de Verificación para Flujo Manual (Chile -> Bolivia)
 */
async function verifyManualFlow() {
    console.log('🚀 Iniciando verificación de Flujo Manual (CL -> BO)...\n');

    try {
        // 1. Verificar Disponibilidad en /prices
        console.log('1️⃣  Verificando API /prices...');
        try {
            const pricesRes = await axios.get(`${API_URL}/prices`);
            const data = pricesRes.data;

            // Buscar si "BO" o "Bolivia" aparece en algún lado
            let foundBO = false;
            let manualRate = null;

            // Comprobando estructura
            const flatPrices = Array.isArray(data) ? data : (data.data || []);
            const boEntry = flatPrices.find(p => p.code === 'BO');

            if (boEntry) {
                foundBO = true;
                manualRate = boEntry.rate;
                console.log(`   ✅ Bolivia encontrado en lista de precios! Rate: ${manualRate}`);
                if (boEntry.isManual) console.log('   ✅ Flag isManual detectada.');
            } else {
                // Fallback check legacy structure
                const clpSell = data?.CLP?.withdrawal?.prices?.attributes?.sell || {};
                if (clpSell['BO']) {
                    foundBO = true;
                    console.log(`   ✅ Bolivia encontrado en estructura Legacy! Rate: ${clpSell['BO']}`);
                }
            }

            if (!foundBO) {
                console.error('   ❌ Bolivia NO aparece en /api/prices');
            }

        } catch (e) {
            console.error('   ❌ Error consultando /prices:', e.message);
        }

        console.log('\n---------------------------------------------------\n');

        // 2. Verificar Cotización (Quote)
        console.log('2️⃣  Verificando API /fx/quote (CL -> BO)...');
        try {
            const quoteRes = await axios.get(`${API_URL}/fx/quote`, {
                params: {
                    amount: 100000,
                    origin: 'CLP',
                    originCountry: 'CL',
                    destCountry: 'BO'
                }
            });

            const q = quoteRes.data.data;
            if (q && q.destCurrency === 'BOB') {
                console.log(`   ✅ Cotización exitosa: 100,000 CLP -> ${q.receiveAmount} BOB`);
                console.log(`   ✅ Tasa aplicada: ${q.rate}`);
                console.log(`   ✅ isManual: ${q.isManual}`);

                if (q.isManual) {
                    console.log('   ✅ Correctamente identificado como manual.');
                } else {
                    console.warn('   ⚠️ WARNING: isManual no es true (podría estar usando tasa Vita si existe).');
                }
            } else {
                console.error('   ❌ Respuesta inesperada:', q);
            }

        } catch (e) {
            console.error('   ❌ Error en cotización:', e.response?.data || e.message);
        }

        console.log('\n---------------------------------------------------\n');

        // 3. Simular Webhook (Detener Payout Automático)
        console.log('3️⃣  Simulando Webhook de Vita (Payin Completed)...');

        // Generar firma HMAC falsa pero válida para nuestra app local
        const webhookSecret = process.env.VITA_WEBHOOK_SECRET;
        if (!webhookSecret) {
            console.warn('   ⚠️ No se puede probar webhook: VITA_WEBHOOK_SECRET no está en .env');
            return;
        }

        const payload = {
            type: 'payment_order.completed',
            payment_order: {
                id: 'po_test_manual_' + Date.now(),
                metadata: {
                    transaction_id: 'no_existe_en_db_pero_ok', // Esto fallará 404 si no creo la tx primero, pero validaremos al menos la lógica
                    destination: {
                        country: 'BO', // <--- LO IMPORTANTE
                        currency: 'BOB',
                        amount: 730
                    },
                    beneficiary: {
                        first_name: 'Juan',
                        last_name: 'Perez',
                        email: 'juan@test.com'
                    }
                }
            }
        };

        const signature = crypto
            .createHmac('sha256', webhookSecret)
            .update(JSON.stringify(payload))
            .digest('hex');

        try {
            // Nota: Esto fallará con 404 porque la Transaction no existe en DB.
            // Pero si vemos el log del backend diciendo "Transacción no encontrada" es que llegó.
            // Para probar bien, deberíamos crear una Tx real, pero es complejo en script simple.
            // Haremos el request y observaremos la respuesta.

            await axios.post(`${API_URL}/webhooks/vita`, payload, {
                headers: { 'x-vita-signature': signature }
            });

        } catch (e) {
            // Esperamos un 404 "Transaction not found" si la lógica de firma pasó.
            // Si fuera 401 "Invalid signature", el test falla.
            if (e.response?.status === 404) {
                console.log('   ✅ Webhook recibido y firma validada (404 esperado pues no creamos Test Transaction).');
                console.log('   ℹ️  Para probar la lógica "Manual Anchor", observa los logs del Backend.');
                console.log('   ℹ️  Debería decir: "🛑 Destino BO es Manual Anchor" si encontrara la transacción.');
            } else if (e.response?.status === 401) {
                console.error('   ❌ Error de firma en Webhook (401). Revisa VITA_WEBHOOK_SECRET.');
            } else {
                console.log(`   ℹ️  Resultado Webhook: ${e.response?.status} ${e.response?.statusText}`);
                if (e.response?.data?.manual) {
                    console.log('   ✅ ÉXITO TOTAL: El webhook respondió con { manual: true }');
                }
            }
        }

    } catch (err) {
        console.error('❌ Error general en script:', err);
    }
}

verifyManualFlow();
