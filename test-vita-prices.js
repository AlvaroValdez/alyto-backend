// backend/test-vita-prices.js
import { client } from './src/services/vitaClient.js';
import fs from 'fs';
import path from 'path';

/**
 * Script para obtener y guardar la respuesta real de /prices de Vita
 * 
 * Uso:
 *   node test-vita-prices.js
 * 
 * El script guardará la respuesta en: vita-prices-response.json
 */

async function testVitaPrices() {
    console.log('🚀 Obteniendo precios reales de Vita...\n');

    try {
        // El vitaClient ya maneja toda la autenticación HMAC-SHA256
        const response = await client.get('/prices');

        console.log('✅ Respuesta recibida exitosamente!');
        console.log('Status:', response.status);
        console.log('\n📊 Estructura de la respuesta:\n');

        // Mostrar preview en consola
        console.log(JSON.stringify(response.data, null, 2));

        // Guardar respuesta completa a archivo
        const outputPath = path.join(process.cwd(), 'vita-prices-response.json');
        fs.writeFileSync(
            outputPath,
            JSON.stringify(response.data, null, 2),
            'utf8'
        );

        console.log(`\n✅ Respuesta guardada en: ${outputPath}`);
        console.log('\n📋 Próximos pasos:');
        console.log('1. Revisar la estructura en vita-prices-response.json');
        console.log('2. Identificar cómo extraer clp_sell para cada país');
        console.log('3. Actualizar normalizePricesFromVita() en vitaService.js');

    } catch (error) {
        console.error('❌ Error obteniendo precios:');
        console.error('Status:', error.response?.status);
        console.error('Message:', error.response?.data?.message || error.message);
        console.error('\nDetalles completos:');
        console.error(JSON.stringify(error.response?.data, null, 2));

        if (error.response?.status === 303) {
            console.error('\n⚠️ Error 303 = Invalid Signature');
            console.error('Verifica que las credenciales en .env sean correctas:');
            console.error('- VITA_LOGIN');
            console.error('- VITA_TRANS_KEY');
            console.error('- VITA_SECRET');
        }
    }
}

// Ejecutar
testVitaPrices()
    .then(() => {
        console.log('\n✅ Test completado');
        process.exit(0);
    })
    .catch((err) => {
        console.error('\n❌ Test falló:', err.message);
        process.exit(1);
    });
