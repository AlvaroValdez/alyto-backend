import Markup from '../models/Markup.js';

const getOrInit = async () => {
  let doc = await Markup.findOne();
  if (!doc) {
    doc = await Markup.create({ defaultPercent: 0, pairs: [] });
  }
  return doc;
};

export const getPercent = async (origin, dest) => {
  try {
    const markupConfig = await Markup.findOne();

    if (!markupConfig) {
      console.warn('⚠️ [markupService] No se encontró configuración de markup en la base de datos. Usando 0% por defecto.');
      return 0;
    }

    const defaultMarkup = markupConfig.defaultPercent || 0;
    console.log(`✅ [markupService] Markup por defecto encontrado: ${defaultMarkup}%.`);
    return defaultMarkup;

  } catch (error) {
    console.error('❌ [markupService] Error al obtener el markup:', error);
    return 0; // Devuelve 0 en caso de error para no detener la operación.
  }
};

export const upsertDefault = async (percent) => {
  const doc = await getOrInit();
  doc.defaultPercent = percent;
  await doc.save();
  return doc;
};

export const upsertPair = async (originCurrency, destCountry, percent) => {
  const doc = await getOrInit();
  const idx = doc.pairs.findIndex(p =>
    p.originCurrency.toUpperCase() === originCurrency.toUpperCase() &&
    p.destCountry.toUpperCase() === destCountry.toUpperCase()
  );

  if (idx >= 0) {
    doc.pairs[idx].percent = percent;
  } else {
    doc.pairs.push({ originCurrency, destCountry, percent });
  }
  
  await doc.save();
  return doc;
};

// Se exporta getOrInit si es necesario en otros archivos. Si no, se puede quitar.
export { getOrInit };