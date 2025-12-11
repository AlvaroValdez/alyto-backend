import express from 'express';
import { getListPrices } from '../services/vitaService.js';
import { extractCountries } from '../utils/normalize.js';

const router = express.Router();

// Cache simple en memoria
let CACHE = { countries: {}, ts: 0 };
const TTL_MS = 90 * 1000;

router.get('/countries', async (req, res) => {
    try {
        const origin = String(req.query.origin || 'CLP').toUpperCase();

        // 1. Revisar Caché
        const now = Date.now();
        if (CACHE.countries[origin] && (now - CACHE.countries[origin].ts) < TTL_MS) {
            // 🔥 CORRECCIÓN: Devolvemos el objeto envuelto { ok, countries }
            const data = CACHE.countries[origin].data;
            return res.json({
                ok: true,
                origin,
                countries: data
            });
        }

        // 2. Obtener y limpiar precios
        const prices = await getListPrices();
        const countries = extractCountries(prices, origin);

        // 3. Guardar en Caché
        CACHE.countries[origin] = { data: countries, ts: now };

        // 4. 🔥 CORRECCIÓN FINAL:
        // Volvemos a la estructura que tu Home.jsx espera.
        // Frontend hace: response.data.countries.map(...)
        return res.json({
            ok: true,
            origin,
            countries: countries
        });

    } catch (err) {
        console.error("❌ Error en meta:", err.message);
        const status = err?.response?.status || 500;
        return res.status(status).json({ ok: false, error: 'Error obteniendo países' });
    }
});

export default router;