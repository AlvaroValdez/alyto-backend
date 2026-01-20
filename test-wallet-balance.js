// test-wallet-balance.js
// Script para probar el endpoint de balance de Vita Wallet

import { getWalletBalance } from './src/services/vitaService.js';

console.log('🧪 Testing Vita Wallet Balance Endpoint...\n');

async function testWalletBalance() {
    try {
        console.log('📡 Calling getWalletBalance()...');
        const balances = await getWalletBalance();

        console.log('\n✅ SUCCESS - Balance retrieved:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        if (balances.length === 0) {
            console.log('⚠️  No balances found (empty array returned)');
            console.log('   This might mean:');
            console.log('   - The wallet has no balances');
            console.log('   - The endpoint structure is different than expected');
            console.log('   - Check the logs above for the actual response');
        } else {
            balances.forEach((balance, index) => {
                console.log(`\n${index + 1}. ${balance.currency}:`);
                console.log(`   Available: $${balance.available.toLocaleString()}`);
                console.log(`   Total:     $${balance.total.toLocaleString()}`);
                console.log(`   Reserved:  $${balance.reserved.toLocaleString()}`);
            });
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✅ Test completed successfully');

    } catch (error) {
        console.log('\n❌ FAILED - Error occurred:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('Error message:', error.message);
        if (error.response) {
            console.error('HTTP Status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        process.exit(1);
    }
}

testWalletBalance();
