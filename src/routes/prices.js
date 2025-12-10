import { Router } from 'express';
import { getListPrices } from '../services/vitaService.js';

const router = Router();

// LISTA MAESTRA DE PAÍSES SOPORTADOS
// Esto asegura que el frontend siempre tenga datos para mostrar,
// independientemente de lo que responda el endpoint de precios de Vita.
const SUPPORTED_COUNTRIES = [
  { code: 'CO', name: 'Colombia', currency: 'COP', flag: '🇨🇴' },
  { code: 'PE', name: 'Perú', currency: 'PEN', flag: '🇵🇪' },
  { code: 'AR', name: 'Argentina', currency: 'ARS', flag: '🇦🇷' },
  { code: 'BR', name: 'Brasil', currency: 'BRL', flag: '🇧🇷' },
  { code: 'MX', name: 'México', currency: 'MXN', flag: '🇲🇽' },
  { code: 'US', name: 'Estados Unidos', currency: 'USD', flag: '🇺🇸' },
  { code: 'VE', name: 'Venezuela', currency: 'VES', flag: '🇻🇪' },
  // NUESTRO ANCHOR MANUAL
  { code: 'BO', name: 'Bolivia', currency: 'BOB', flag: '🇧🇴', manual: true }
];

router.get('/', async (req, res) => {
  try {
    // 1. Consultamos a Vita (solo para verificar conectividad/status)
    // No usamos estos datos para la lista porque vienen en formato objeto { usd: ..., btc: ... }
    try {
      await getListPrices();
    } catch (err) {
      console.warn('⚠️ [prices] Vita no respondió precios, usando estáticos.', err.message);
    }

    // 2. Devolvemos la lista maestra formateada
    // El frontend recibirá exactamente el Array que necesita.
    res.json({
      ok: true,
      data: SUPPORTED_COUNTRIES
    });

  } catch (error) {
    console.error("❌ [prices] Error fatal:", error.message);
    // Fallback de seguridad: devolvemos la lista incluso si hay error interno
    res.json({ ok: true, data: SUPPORTED_COUNTRIES });
  }
});

export default router;