// backend/src/services/markupService.js
const Markup = require('../models/Markup');

async function getOrInit() {
  let doc = await Markup.findOne();
  if (!doc) doc = await Markup.create({ defaultPercent: 0, pairs: [] });
  return doc;
}

const getPercent = async (origin, dest) => {
  try {
    // Busca la primera configuración de markup que encuentre (debería haber solo una)
    const markupConfig = await Markup.findOne();

    if (!markupConfig) {
      console.warn('⚠️ [markupService] No se encontró configuración de markup en la base de datos. Usando 0% por defecto.');
      return 0;
    }

    // Por ahora, solo usamos el markup por defecto.
    // En el futuro, aquí iría la lógica para buscar en el array 'pairs'.
    const defaultMarkup = markupConfig.defaultPercent || 0;
    
    console.log(`✅ [markupService] Markup por defecto encontrado: ${defaultMarkup}%.`);
    return defaultMarkup;

  } catch (error) {
    console.error('❌ [markupService] Error al obtener el markup:', error);
    return 0; // En caso de error, siempre devuelve 0 para no detener la operación.
  }
};

async function upsertDefault(percent) {
  const doc = await getOrInit();
  doc.defaultPercent = percent;
  await doc.save();
  return doc;
}

async function upsertPair(originCurrency, destCountry, percent) {
  const doc = await getOrInit();
  const idx = doc.pairs.findIndex(p =>
    p.originCurrency.toUpperCase() === originCurrency.toUpperCase() &&
    p.destCountry.toUpperCase() === destCountry.toUpperCase()
  );
  if (idx >= 0) doc.pairs[idx].percent = percent;
  else doc.pairs.push({ originCurrency, destCountry, percent });
  await doc.save();
  return doc;
}

module.exports = { getPercent, upsertDefault, upsertPair, getOrInit };
