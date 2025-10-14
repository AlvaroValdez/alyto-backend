// backend/src/app.js
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const connectMongo = require('./config/mongo'); 
const app = express();

// --- CONFIGURACIÓN DE CORS MEJORADA ---
// Lista de orígenes permitidos
const allowedOrigins = [
  'http://localhost:5173', // Tu frontend en desarrollo local
  // Aquí puedes añadir la URL de tu frontend cuando lo despliegues, ej:
  // 'https://avf-remesas-frontend.onrender.com'
];

const corsOptions = {
  origin: function (origin, callback) {
    // Permite peticiones sin origen (como las de Postman o apps móviles) y las de la lista blanca
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions)); // Usa las opciones configuradas

// Middlewares
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Conexión a Mongo
connectMongo(); // ✅ ejecutamos la función exportada

app.post('/api/ipn/vita/raw', (req, res) => {
  console.log('[raw] Headers:', req.headers);
  res.json({ ok: true });
});


// Rutas
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Backend funcionando 🚀' });
});

// Importar rutas reales
app.use('/api/prices', require('./routes/prices'));
app.use('/api/withdrawals', require('./routes/withdrawals'));
app.use('/api/ipn', require('./routes/ipn')); 
app.use('/api/ipn', require('./routes/ipnEvents'));
app.use('/api/fx', require('./routes/fx'));
app.use('/api/transactions', require('./routes/transactions'));
app.use("/api/auth", require("./routes/auth"));
app.use('/api/withdrawal-rules', require('./routes/withdrawalRules')); 

// Rutas admin
app.use('/api/admin', require('./routes/adminMarkup'));


module.exports = app;