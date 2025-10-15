import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import connectMongo from './config/mongo.js';
import ipnRoutes from './routes/ipn.js';

// Importación de todas las rutas al inicio del archivo
import pricesRoutes from './routes/prices.js';
import withdrawalsRoutes from './routes/withdrawals.js';
import ipnEventsRoutes from './routes/ipnEvents.js';
import fxRoutes from './routes/fx.js';
import transactionsRoutes from './routes/transactions.js';
import authRoutes from './routes/auth.js';
import withdrawalRulesRoutes from './routes/withdrawalRules.js';
import adminMarkupRoutes from './routes/adminMarkup.js';
import paymentOrdersRoutes from './routes/paymentOrders.js'; // <-- Ruta nueva añadida

const app = express();

// Conexión a la base de datos
connectMongo();

// --- Configuración de CORS ---
const allowedOrigins = [
  'http://localhost:5173', // Frontend en desarrollo
  // 'https://tu-frontend-en-produccion.com' // Añadir la URL del frontend en producción
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Acceso no permitido por CORS'));
    }
  },
};

// --- Middlewares ---
app.use(cors(corsOptions)); // Usa la configuración de CORS personalizada
app.use(morgan('dev'));

// La ruta del IPN necesita el "cuerpo crudo", por lo que se monta ANTES de express.json()
app.use('/api/ipn', ipnRoutes);
app.use(express.json()); // Middleware para parsear JSON para el resto de las rutas

// --- Rutas de la API ---
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Backend funcionando 🚀' });
});

app.use('/api/prices', pricesRoutes);
app.use('/api/withdrawals', withdrawalsRoutes);
app.use('/api/ipn/events', ipnEventsRoutes); // <-- Ruta corregida
app.use('/api/fx', fxRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/withdrawal-rules', withdrawalRulesRoutes);
app.use('/api/admin', adminMarkupRoutes);
app.use('/api/payment-orders', paymentOrdersRoutes); // <-- Ruta nueva montada

// Aquí iría el middleware de manejo de errores al final
// app.use(errorHandler);

export default app;