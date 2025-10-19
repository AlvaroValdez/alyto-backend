import Markup from '../models/Markup.js';

const getOrInit = async () => {
  let doc = await Markup.findOne();
  if (!doc) {
    // Asegúrate de que el valor inicial sea el correcto (ej: 3 para 3%)
    doc = await Markup.create({ defaultPercent: 3, pairs: [] }); 
  }
  return doc;
};

// --- LÓGICA DE getPercent MEJORADA ---
export const getPercent = async (origin, dest) => {
  try {
    const markupConfig = await getOrInit(); // Usa getOrInit para asegurar que exista

    // 1. Busca una comisión específica para el par (ignorando mayúsculas/minúsculas)
    const specificPair = markupConfig.pairs.find(p =>
      p.originCurrency.toUpperCase() === origin.toUpperCase() &&
      p.destCountry.toUpperCase() === dest.toUpperCase()
    );

    if (specificPair) {
      console.log(`✅ [markupService] Markup específico encontrado para ${origin}→${dest}: ${specificPair.percent}%.`);
      return specificPair.percent;
    }

    // 2. Si no hay par específico, usa el valor por defecto
    const defaultMarkup = markupConfig.defaultPercent || 0;
    console.log(`✅ [markupService] Usando markup por defecto: ${defaultMarkup}%.`);
    return defaultMarkup;

  } catch (error) {
    console.error('❌ [markupService] Error al obtener el markup:', error);
    return 0; 
  }
};

export const upsertDefault = async (percent) => { /* ... (sin cambios) */ };
export const upsertPair = async (originCurrency, destCountry, percent) => { /* ... (sin cambios) */ };
export { getOrInit };