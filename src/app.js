import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import connectMongo from './config/mongo.js';
import { protect, isAdmin } from './middleware/authMiddleware.js';

// Importación de rutas
import pricesRoutes from './routes/prices.js';
import withdrawalsRoutes from './routes/withdrawals.js';
import ipnRoutes from './routes/ipn.js';
import ipnEventsRoutes from './routes/ipnEvents.js';
import fxRoutes from './routes/fx.js';
import transactionsRoutes from './routes/transactions.js';
import authRoutes from './routes/auth.js';
import withdrawalRulesRoutes from './routes/withdrawalRules.js';
import adminMarkupRoutes from './routes/adminMarkup.js';
import paymentOrdersRoutes from './routes/paymentOrders.js';
import adminUsersRoutes from './routes/adminUsers.js'
import beneficiariesRoutes from './routes/beneficiaries.js';
import adminKycRoutes from './routes/adminKyc.js';
import transactionRulesRoutes from './routes/transactionRules.js';
import uploadRoutes from './routes/upload.js';
import adminTreasuryRoutes from './routes/adminTreasury.js';

const app = express();

connectMongo();

// --- Configuración de CORS ---
const allowedOrigins = [
  'http://localhost:5173', // Frontend dev
  'https://avf-vita-fe10.onrender.com' // Frontend producción
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Acceso no permitido por CORS desde origen: ${origin}`));
    }
  },
  optionsSuccessStatus: 200
};

// --- Middlewares ---
// 1. CORS debe ir PRIMERO para aplicarse a todas las rutas
app.use(cors(corsOptions));
app.use(morgan('dev'));
// 2. La ruta IPN ANTES de express.json()
app.use('/api/ipn', ipnRoutes);
// 3. express.json() DESPUÉS de IPN pero ANTES de otras rutas API
app.use(express.json());

// --- Rutas de la API ---
app.get('/api/health', (req, res) => res.json({ ok: true, message: 'Backend funcionando 🚀' }));
app.use('/api/auth', authRoutes); // Rutas públicas de autenticación
app.use('/api/prices', pricesRoutes);
app.use('/api/transaction-rules', transactionRulesRoutes);
app.use('/api/withdrawal-rules', withdrawalRulesRoutes);
app.use('/api/fx', fxRoutes);

// --- Rutas Protegidas ---
app.use('/api/withdrawals', protect, withdrawalsRoutes);
app.use('/api/ipn/events', protect, ipnEventsRoutes);
app.use('/api/transactions', protect, transactionsRoutes);
app.use('/api/payment-orders', protect, paymentOrdersRoutes);
app.use('/api/beneficiaries', protect, beneficiariesRoutes);
app.use('/api/upload', protect, uploadRoutes);

// --- Rutas de Administración ---
app.use('/api/admin', protect, isAdmin, adminMarkupRoutes);
app.use('/api/admin', protect, isAdmin, adminUsersRoutes);
app.use('/api/admin/kyc', protect, isAdmin, adminKycRoutes);
app.use('/api/admin/treasury', protect, isAdmin, adminTreasuryRoutes);


export default app;