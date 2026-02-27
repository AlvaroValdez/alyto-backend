const fetch = require('node-fetch');

async function test() {
  const start = Date.now();
  try {
    const res = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'password123' })
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Time:', Date.now() - start, 'ms');
  } catch (e) {
    console.error(e);
  }
}
test();
