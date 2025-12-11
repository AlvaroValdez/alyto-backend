import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import connectMongo from './config/mongo.js';
import { protect, isAdmin } from './middleware/authMiddleware.js';

// --- IMPORTACIÓN DE RUTAS ---
import authRoutes from './routes/auth.js';
import pricesRoutes from './routes/prices.js';
import fxRoutes from './routes/fx.js';
import withdrawalRulesRoutes from './routes/withdrawalRules.js';
import transactionRulesRoutes from './routes/transactionRules.js';
import ipnRoutes from './routes/ipn.js';
import ipnEventsRoutes from './routes/ipnEvents.js';
import withdrawalsRoutes from './routes/withdrawals.js';
import transactionsRoutes from './routes/transactions.js';
import paymentOrdersRoutes from './routes/paymentOrders.js';
import beneficiariesRoutes from './routes/beneficiaries.js';
import uploadRoutes from './routes/upload.js';
import metaRoutes from './routes/meta.js';

// --- RUTAS ADMIN ---
import adminMarkupRoutes from './routes/adminMarkup.js';
import adminUsersRoutes from './routes/adminUsers.js';
import adminKycRoutes from './routes/adminKyc.js';
import adminTreasuryRoutes from './routes/adminTreasury.js';

const app = express();

// Conexión a Base de Datos
connectMongo();

// --- CONFIGURACIÓN CORS ---
const allowedOrigins = [
  'http://localhost:5173',           // Frontend Desarrollo
  'https://avf-vita-fe10.onrender.com' // Frontend Producción
];

const corsOptions = {
  origin: (origin, callback) => {
    // Permitir solicitudes sin origen (como Postman o Server-to-Server)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`Bloqueo CORS para origen: ${origin}`);
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true, // Importante si manejas cookies/headers de auth
  optionsSuccessStatus: 200
};

// --- MIDDLEWARES GLOBALES ---
app.use(cors(corsOptions));
app.use(morgan('dev'));

// 1. Webhooks (IPN): Deben ir ANTES de express.json si requieren raw body
app.use('/api/ipn', ipnRoutes);

// 2. Parser JSON: Para el resto de la API
app.use(express.json());

// --- HEALTH CHECK (Público) ---
app.get('/api/health', (req, res) => res.json({ ok: true, message: 'Backend funcionando 🚀' }));

// ==========================================
// 🔓 RUTAS PÚBLICAS (SIN PROTECCIÓN)
// ==========================================
// Estas rutas NO pasan por el middleware 'protect'

app.use('/api/auth', authRoutes);
app.use('/api/prices', pricesRoutes); // <--- ESTA ES LA CLAVE. Está libre.
app.use('/api/fx', fxRoutes);         // Cotizador
app.use('/api/withdrawal-rules', withdrawalRulesRoutes);
app.use('/api/transaction-rules', transactionRulesRoutes);
app.use('/api/meta', metaRoutes);

// ==========================================
// 🔒 RUTAS PROTEGIDAS (USUARIOS LOGUEADOS)
// ==========================================
// Todas estas rutas requieren Token válido

app.use('/api/withdrawals', protect, withdrawalsRoutes);
app.use('/api/transactions', protect, transactionsRoutes);
app.use('/api/payment-orders', protect, paymentOrdersRoutes);
app.use('/api/beneficiaries', protect, beneficiariesRoutes);
app.use('/api/upload', protect, uploadRoutes);
app.use('/api/ipn/events', protect, ipnEventsRoutes);

// ==========================================
// 🛡️ RUTAS ADMINISTRADOR
// ==========================================
// Requieren Token + Rol Admin

app.use('/api/admin/markup', protect, isAdmin, adminMarkupRoutes); // (Ajusté la ruta para consistencia, verifica si en frontend llamas a /api/admin o /api/admin/markup)
app.use('/api/admin', protect, isAdmin, adminUsersRoutes); // Ojo con el path base aquí, suele ser mejor ser específico
app.use('/api/admin/kyc', protect, isAdmin, adminKycRoutes);
app.use('/api/admin/treasury', protect, isAdmin, adminTreasuryRoutes);

export default app;