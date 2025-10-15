import axios from 'axios';
import crypto from 'crypto';
import { vita } from '../config/env.js';

// Crea la instancia de Axios con la configuración base
const client = axios.create({
  baseURL: vita.baseURL,
  timeout: 15000,
});

// Interceptor para firmar todas las peticiones salientes a Vita
client.interceptors.request.use(config => {
  const xDate = new Date().toISOString();
  const xLogin = vita.login;
  let sortedRequestBody = '';

  if (config.data) {
    const sortedData = Object.keys(config.data).sort().reduce((acc, key) => {
      acc[key] = config.data[key];
      return acc;
    }, {});
    sortedRequestBody = JSON.stringify(sortedData).replace(/\//g, '\\/');
  }
  
  const signatureString = `${xLogin}${xDate}${sortedRequestBody}`;
  const signature = crypto.createHmac('sha256', vita.secret).update(signatureString).digest('hex');

  config.headers['X-Date'] = xDate;
  config.headers['X-Login'] = xLogin;
  config.headers['X-Trans-Key'] = vita.transKey;
  config.headers['Authorization'] = `V2-HMAC-SHA256, Signature: ${signature}`;

  return config;
});

// Exporta la instancia de Axios configurada
export { client };