// Environment Variable Validation Script
// Add this at the top of backend/src/app.js or server.js

console.log('\n🔧 [Env Validation] Checking critical environment variables...');

const criticalEnvVars = {
    'FRONTEND_URL': process.env.FRONTEND_URL,
    'EMAIL_FROM': process.env.EMAIL_FROM,
    'SENDGRID_API_KEY': process.env.SENDGRID_API_KEY ? '✅ SET (length: ' + process.env.SENDGRID_API_KEY.length + ')' : '❌ MISSING',
    'JWT_SECRET': process.env.JWT_SECRET ? '✅ SET' : '❌ MISSING',
    'MONGODB_URI': process.env.MONGODB_URI ? '✅ SET' : '❌ MISSING',
};

let hasError = false;

Object.entries(criticalEnvVars).forEach(([key, value]) => {
    if (!value || value.includes('MISSING')) {
        console.error(`  ❌ ${key}: MISSING`);
        hasError = true;
    } else {
        // Don't log full value for security, just status
        if (key === 'SENDGRID_API_KEY') {
            console.log(`  ✅ ${key}: ${value}`);
        } else if (key === 'JWT_SECRET' || key === 'MONGODB_URI') {
            console.log(`  ✅ ${key}: SET`);
        } else {
            console.log(`  ✅ ${key}: ${value}`);
        }
    }
});

if (hasError) {
    console.error('\n⚠️  [Env Validation] Some critical environment variables are missing!');
    console.error('   Please check your .env file.\n');
} else {
    console.log('\n✅ [Env Validation] All critical environment variables are set.\n');
}
