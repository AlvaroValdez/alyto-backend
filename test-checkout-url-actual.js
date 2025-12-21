// test-checkout-url-actual.js
// Ejecutar: node test-checkout-url-actual.js

const vitaCheckoutBase = process.env.VITA_CHECKOUT_BASE_URL || 'https://checkout.stage.vitawallet.io';

console.log('🔍 Verificando URL de Checkout:\n');
console.log('VITA_CHECKOUT_BASE_URL:', process.env.VITA_CHECKOUT_BASE_URL || '(undefined - usando fallback)');
console.log('Base URL final:', vitaCheckoutBase);

// Simular construcción de URL
const id = '3381';
const publicCode = 'c8e96adf-bd19-4fa1-b153-01c86c64370a';

const checkoutUrl = `${vitaCheckoutBase.replace(/\/$/, '')}/p/${encodeURIComponent(id)}?public_code=${encodeURIComponent(publicCode)}`;

console.log('\n✅ URL que DEBERÍA generarse:');
console.log(checkoutUrl);

console.log('\n❌ URL incorrecta (la que falla):');
console.log('https://stage.vitawallet.io/checkout?id=3381&public_code=...');

console.log('\n📝 Diferencias:');
console.log('✅ Correcto: checkout.stage.vitawallet.io/p/3381?public_code=...');
console.log('❌ Incorrecto: stage.vitawallet.io/checkout?id=3381&public_code=...');

console.log('\n💡 Si ves la URL incorrecta, el backend NO tiene el código actualizado.');
