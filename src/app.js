// backend/src/app.js
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const connectMongo = require('./config/mongo'); 

const app = express();

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