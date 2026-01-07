// Script para crear markups por defecto usando la API
const createDefaultMarkups = async () => {
    const baseUrl = 'http://localhost:3000/api/admin';

    // 1. Crear markup global por defecto (2%)
    console.log('1. Creando markup global por defecto...');
    const defaultResponse = await fetch(`${baseUrl}/markup/default`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ percent: 2.0 })
    });
    const defaultData = await defaultResponse.json();
    console.log('✅ Global default:', defaultData);

    // 2. Crear markup específico CL -> CO (2.5%)
    console.log('\n2. Creando markup CL → CO...');
    const clCoResponse = await fetch(`${baseUrl}/markup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            originCountry: 'CL',
            destCountry: 'CO',
            percent: 2.5,
            description: 'Chile → Colombia (corredor principal)'
        })
    });
    const clCoData = await clCoResponse.json();
    console.log('✅ CL→CO:', clCoData);

    // 3. Crear markup default para Chile (2%)
    console.log('\n3. Creando markup default para Chile...');
    const clDefaultResponse = await fetch(`${baseUrl}/markup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            originCountry: 'CL',
            percent: 2.0,
            description: 'Default para Chile (todos los destinos)'
        })
    });
    const clDefaultData = await clDefaultResponse.json();
    console.log('✅ CL default:', clDefaultData);

    // 4. Verificar todos los markups
    console.log('\n4. Verificando markups creados...');
    const allMarkupsResponse = await fetch(`${baseUrl}/markup`);
    const allMarkupsData = await allMarkupsResponse.json();
    console.log('✅ Todos los markups:', JSON.stringify(allMarkupsData, null, 2));
};

createDefaultMarkups().catch(console.error);
