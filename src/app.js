// backend/src/app.js
const express = require('express');
const cors = require('cors');
const { connectMongo } = require('./config/mongo');
const { mongoURI } = require('./config/env');
const errorHandler = require('./middleware/errorHandler');

const prices = require('./routes/prices');
const fx = require('./routes/fx');
const withdrawals = require('./routes/withdrawals');
const ipn = require('./routes/ipn');
const withdrawalRules = require('./routes/withdrawalRules');

const app = express();
app.use(cors());
app.use(express.json());

// Rutas API (aditivas)
app.use('/api/prices', prices);
app.use('/api/fx', fx);
app.use('/api/withdrawals', withdrawals);
app.use('/api/ipn', ipn);
app.use('/api/withdrawal_rules', withdrawalRules);

// Health
app.get('/api/health', (_, res) => res.json({ ok: true }));

// Errores
app.use(errorHandler);

// Init Mongo
connectMongo(mongoURI).catch((e) => {
  console.error('[mongo] error', e);
  process.exit(1);
});

module.exports = app;
