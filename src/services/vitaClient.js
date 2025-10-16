import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

const client = axios.create({
  baseURL: vita.baseURL,
  timeout: 15000,
});

// Interceptor para firmar todas las peticiones salientes a Vita
client.interceptors.request.use(config => {
  const xDate = new Date().toISOString();
  const xLogin = vita.login;
  let signatureBody = '';

  // --- CORRECCIÓN DE LÓGICA DE FIRMA ---
  if (config.data) {
    // 1. Ordena las claves del objeto alfabéticamente
    const sortedKeys = Object.keys(config.data).sort();
    
    // 2. Concatena los pares 'clavevalor' sin separadores
    signatureBody = sortedKeys.map(key => `${key}${config.data[key]}`).join('');
  }
  
  const signatureString = `${xLogin}${xDate}${signatureBody}`;
  const signature = crypto.createHmac('sha256', vita.secret).update(signatureString).digest('hex');

  config.headers['X-Date'] = xDate;
  config.headers['X-Login'] = xLogin;
  config.headers['X-Trans-Key'] = vita.transKey;
  config.headers['Authorization'] = `V2-HMAC-SHA256, Signature: ${signature}`;

  return config;
});

export { client };