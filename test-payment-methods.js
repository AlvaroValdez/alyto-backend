// Script de prueba para verificar métodos de pago disponibles en Chile
// Ejecutar: node backend/test-payment-methods.js

import { getPaymentMethods } from './src/services/vitaService.js';

async function testPaymentMethods() {
    console.log('🔍 Verificando métodos de pago disponibles para Chile...\n');

    try {
        const result = await getPaymentMethods('cl');

        console.log('✅ Respuesta recibida de Vita:');
        console.log(JSON.stringify(result, null, 2));

        console.log('\n📋 Métodos disponibles:');
        const methods = result?.payment_methods || result?.data?.payment_methods || [];

        if (methods.length === 0) {
            console.log('⚠️  No se encontraron métodos de pago');
            console.log('Estructura de respuesta:', Object.keys(result));
        } else {
            methods.forEach((method, index) => {
                console.log(`\n${index + 1}. ${method.name || method.code}`);
                console.log(`   Código: ${method.code}`);
                console.log(`   Tipo: ${method.type || 'N/A'}`);

                if (method.required_fields && method.required_fields.length > 0) {
                    console.log(`   Campos requeridos:`);
                    method.required_fields.forEach(field => {
                        console.log(`     - ${field.name}: ${field.label || field.type}`);
                    });
                }

                // Verificar si es DirectPay o Redirect
                const isDirectPay = ['fintoc', 'pse', 'nequi', 'daviplata'].includes(method.code?.toLowerCase());
                console.log(`   DirectPay: ${isDirectPay ? '✅ SÍ' : '❌ NO (Redirect)'}`);
            });
        }

        console.log('\n\n🎯 Recomendación para marca blanca:');
        const fintoc = methods.find(m => m.code?.toLowerCase() === 'fintoc');
        if (fintoc) {
            console.log('✅ FINTOC está disponible - Úsalo para DirectPay marca blanca');
        } else {
            console.log('⚠️  FINTOC no está disponible');
            console.log('   Opciones:');
            console.log('   1. Contactar a Vita para habilitar Fintoc');
            console.log('   2. Usar Webpay con redirect (no es marca blanca)');
        }

    } catch (error) {
        console.error('❌ Error al obtener métodos de pago:');
        console.error(error.message);
        if (error.response?.data) {
            console.error('Detalles:', error.response.data);
        }
    }
}

testPaymentMethods();
