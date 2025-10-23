import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import connectMongo from './config/mongo.js';
import ipnRoutes from './routes/ipn.js';
import { protect } from './middleware/authMiddleware.js';

// Importación de todas las rutas al inicio del archivo
import pricesRoutes from './routes/prices.js';
import withdrawalsRoutes from './routes/withdrawals.js';
import ipnEventsRoutes from './routes/ipnEvents.js';
import fxRoutes from './routes/fx.js';
import transactionsRoutes from './routes/transactions.js';
import authRoutes from './routes/auth.js';
import withdrawalRulesRoutes from './routes/withdrawalRules.js';
import adminMarkupRoutes from './routes/adminMarkup.js';
import paymentOrdersRoutes from './routes/paymentOrders.js'; 

const app = express();

// Conexión a la base de datos
connectMongo();

// --- Configuración de CORS ---
const allowedOrigins = [
  'https://avf-vita-fe10.onrender.com' // Frontend en producción
  //'http://localhost:5173', // Frontend en desarrollo
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

// --- Rutas Públicas ---
app.get('/api/health', (req, res) => res.json({ ok: true, message: 'Backend funcionando 🚀' }));
app.use('/api/auth', authRoutes); // Login y Registro son públicos

// --- Rutas Protegidas ---
// Todas las rutas definidas DESPUÉS de aquí requerirán un token válido
app.use('/api/prices', protect, pricesRoutes); // Protegemos prices
app.use('/api/withdrawals', protect, withdrawalsRoutes); // Protegemos withdrawals
app.use('/api/ipn/events', protect, ipnEventsRoutes); // Protegemos historial IPN
app.use('/api/fx', protect, fxRoutes); // Protegemos cotización
app.use('/api/transactions', protect, transactionsRoutes); // Protegemos historial transacciones
app.use('/api/withdrawal-rules', protect, withdrawalRulesRoutes); // Protegemos reglas
app.use('/api/payment-orders', protect, paymentOrdersRoutes); // Protegemos creación de órdenes

// --- Rutas de Administración Protegidas ---
// Podríamos añadir un middleware 'isAdmin' aquí en el futuro
app.use('/api/admin', protect, adminMarkupRoutes);

// Aquí iría el middleware de manejo de errores al final
// app.use(errorHandler);

export default app;