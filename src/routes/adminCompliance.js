// backend/src/routes/adminCompliance.js
import { Router } from 'express';
import { protect, isAdmin } from '../middleware/authMiddleware.js';
import ComplianceLimits from '../models/ComplianceLimits.js';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import { seedBoliviaLimits } from '../services/complianceService.js';

const router = Router();

// Todos los endpoints requieren admin
router.use(protect, isAdmin);

// GET /api/admin/compliance/limits
// Listar todos los límites de cumplimiento configurados
router.get('/limits', async (req, res) => {
    try {
        const limits = await ComplianceLimits.find().sort({ country: 1 });
        res.json({ ok: true, limits });
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Error obteniendo límites' });
    }
});

// GET /api/admin/compliance/limits/:country
// Obtener límites de un país específico
router.get('/limits/:country', async (req, res) => {
    try {
        const { country } = req.params;
        const limits = await ComplianceLimits.findOne({ country: country.toUpperCase() });

        if (!limits) {
            return res.status(404).json({ ok: false, error: `No se encontraron límites para ${country}` });
        }

        res.json({ ok: true, limits });
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Error obteniendo límites' });
    }
});

// POST /api/admin/compliance/limits
// Crear o actualizar límites de cumplimiento para un país
router.post('/limits', async (req, res) => {
    try {
        const { country, currency, kycLevels, amlThresholds, restrictions, regulatory } = req.body;

        if (!country || !currency) {
            return res.status(400).json({ ok: false, error: 'country y currency son obligatorios' });
        }

        const limits = await ComplianceLimits.findOneAndUpdate(
            { country: country.toUpperCase() },
            {
                country: country.toUpperCase(),
                currency: currency.toUpperCase(),
                kycLevels: kycLevels || {},
                amlThresholds: amlThresholds || {},
                restrictions: restrictions || {},
                regulatory: regulatory || {},
                isActive: true
            },
            { upsert: true, new: true, runValidators: true }
        );

        res.json({ ok: true, message: 'Límites actualizados', limits });
    } catch (error) {
        console.error('[adminCompliance] Error actualizando límites:', error);
        res.status(500).json({ ok: false, error: 'Error actualizando límites: ' + error.message });
    }
});

// POST /api/admin/compliance/seed-bolivia
// Inicializar límites de Bolivia (ASFI)
router.post('/seed-bolivia', async (req, res) => {
    try {
        await seedBoliviaLimits();
        res.json({ ok: true, message: 'Límites de Bolivia inicializados correctamente' });
    } catch (error) {
        console.error('[adminCompliance] Error seeding Bolivia:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// GET /api/admin/compliance/report/:userId
// Generar reporte de cumplimiento para un usuario
router.get('/report/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { period = 'month' } = req.query; // day, month, year

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
        }

        // Calcular fecha inicio según período
        const now = new Date();
        let since;
        switch (period) {
            case 'day':
                since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                break;
            case 'year':
                since = new Date(now.getFullYear(), 0, 1);
                break;
            case 'month':
            default:
                since = new Date(now.getFullYear(), now.getMonth(), 1);
        }

        // Obtener transacciones del período
        const transactions = await Transaction.find({
            createdBy: userId,
            createdAt: { $gte: since },
            status: { $in: ['pending', 'processing', 'succeeded'] }
        }).sort({ createdAt: -1 });

        // Agrupar por moneda
        const byCurrency = {};
        let totalAmount = 0;
        let highRiskCount = 0;

        transactions.forEach(tx => {
            const curr = tx.currency.toUpperCase();
            if (!byCurrency[curr]) {
                byCurrency[curr] = { count: 0, total: 0, transactions: [] };
            }
            byCurrency[curr].count++;
            byCurrency[curr].total += tx.amount;
            byCurrency[curr].transactions.push(tx);
            totalAmount += tx.amount;

            // Marcar transacciones de alto riesgo (>$10k USD equiv)
            if (tx.amount > 70000) { // Estimado en BOB
                highRiskCount++;
            }
        });

        const report = {
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                kycLevel: user.kyc?.level || 1,
                kycStatus: user.kyc?.status || 'unverified'
            },
            period: {
                type: period,
                since,
                until: now
            },
            summary: {
                totalTransactions: transactions.length,
                totalAmount,
                byCurrency,
                highRiskTransactions: highRiskCount
            },
            transactions
        };

        res.json({ ok: true, report });
    } catch (error) {
        console.error('[adminCompliance] Error generando reporte:', error);
        res.status(500).json({ ok: false, error: 'Error generando reporte' });
    }
});

// GET /api/admin/compliance/high-risk
// Listar transacciones de alto riesgo pendientes de revisión
router.get('/high-risk', async (req, res) => {
    try {
        // Transacciones pendientes con monto alto
        const highRiskTx = await Transaction.find({
            status: { $in: ['pending_verification', 'pending_manual_payout'] },
            amount: { $gte: 35000 } // Umbral sospechoso Bolivia
        })
            .populate('createdBy', 'name email kyc')
            .sort({ createdAt: -1 })
            .limit(50);

        res.json({ ok: true, transactions: highRiskTx, count: highRiskTx.length });
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Error obteniendo transacciones de alto riesgo' });
    }
});

export default router;
