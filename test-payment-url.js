// backend/test-payment-url.js
// Script rápido para verificar qué URL está generando el backend
// Ejecutar: node test-payment-url.js

// Simula la construcción de URL exactamente como lo hace paymentOrders.js
const vitaCheckoutBase = process.env.VITA_CHECKOUT_BASE_URL || 'https://checkout.stage.vitawallet.io';

// Datos de ejemplo (simula respuesta de Vita)
const raw = {
    id: '3381',
    attributes: {
        public_code: 'c8e96adf-bd19-4fa1-b153-01c86c64370a'
    }
};

const id = raw?.id || raw?.data?.id;
const publicCode = raw?.attributes?.public_code || raw?.data?.attributes?.public_code;

let checkoutUrl = null;

if (id && publicCode) {
    checkoutUrl = `${vitaCheckoutBase.replace(/\/$/, '')}/p/${encodeURIComponent(id)}?public_code=${encodeURIComponent(publicCode)}`;
    console.log('✅ Checkout URL construida:', checkoutUrl);
} else {
    console.error('❌ No se pudo construir checkout URL');
    console.error('id:', id, 'publicCode:', publicCode);
}

console.log('\n📋 Comparación:');
console.log('❌ URL con error:  https://stage.vitawallet.io/checkout?id=3381&public_code=...');
console.log('✅ URL correcta: ', checkoutUrl);
console.log('\n💡 La URL correcta debe tener:');
console.log('   - Subdominio "checkout." al inicio');
console.log('   - Ruta "/p/ID" en lugar de "/checkout?id=ID"');
