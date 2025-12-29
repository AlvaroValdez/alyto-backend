
import { client } from './src/services/vitaClient.js';

console.log('Testing GET /payment_methods/CL ...');

async function test() {
    try {
        const response = await client.get('/payment_methods/CL');
        console.log('Response Status:', response.status);

        const methods = response.data.payment_methods || response.data;
        console.log('Methods found:', methods.length);

        const fintoc = methods.find(m => m.name && m.name.toLowerCase() === 'fintoc');
        if (fintoc) {
            console.log('SUCCESS: Fintoc method found!');
            console.log('Fintoc ID:', fintoc.method_id);
            console.log('Full Fintoc Object:', JSON.stringify(fintoc, null, 2));
        } else {
            console.error('FAILURE: Fintoc method NOT found in response.');
            console.log('Full response data:', JSON.stringify(methods, null, 2));
        }

    } catch (error) {
        console.error('Error calling API:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
    }
}

test();
