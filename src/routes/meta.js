// src/routes/meta.js
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

        // 1. Revisar Caché local de la ruta
        const now = Date.now();
        if (CACHE.countries[origin] && (now - CACHE.countries[origin].ts) < TTL_MS) {
            return res.json({ ok: true, origin, countries: CACHE.countries[origin].data });
        }

        // 2. Obtener precios (El servicio ya maneja el mock/stage si es necesario)
        const prices = await getListPrices();

        // 3. Formatear para el frontend usando el utils restaurado
        const countries = extractCountries(prices, origin);

        // 4. Guardar caché
        CACHE.countries[origin] = { data: countries, ts: now };

        // 5. Responder con la estructura { ok, origin, countries }
        return res.json({ ok: true, origin, countries });

    } catch (err) {
        console.error("❌ Error en /api/meta/countries:", err.message);
        const status = err?.response?.status || 500;
        return res.status(status).json({ ok: false, error: 'Error obteniendo países' });
    }
});

export default router;