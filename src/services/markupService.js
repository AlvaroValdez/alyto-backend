import Markup from '../models/Markup.js';

/**
 * Busca el documento de configuración de markup en la base de datos.
 * Si no existe, lo crea con valores por defecto (ej: 3% por defecto).
 * @returns {Promise<object>} El documento de configuración de markup.
 */
const getOrInit = async () => {
  let doc = await Markup.findOne();
  if (!doc) {
    console.log('[markupService] No se encontró documento de markup, creando uno nuevo...');
    // Establece el valor inicial por defecto (ajusta si es necesario)
    doc = await Markup.create({ defaultPercent: 3, pairs: [] });
    console.log('[markupService] Nuevo documento de markup creado.');
  }
  return doc;
};

/**
 * Obtiene el porcentaje de markup a aplicar para un par de divisas específico.
 * Busca primero una comisión específica para el par (origen -> destino).
 * Si no la encuentra, devuelve la comisión por defecto.
 * @param {string} origin - Código de la moneda de origen (ej: 'CLP').
 * @param {string} dest - Código del país de destino (ej: 'CO').
 * @returns {Promise<number>} El porcentaje de markup a aplicar.
 */
export const getPercent = async (origin, dest) => {
  try {
    const markupConfig = await getOrInit(); // Asegura que el documento exista

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
    return 0; // Devuelve 0 en caso de error para no detener la operación.
  }
};

/**
 * Actualiza (o crea si no existe) el porcentaje de markup por defecto.
 * @param {number} percent - El nuevo porcentaje por defecto.
 * @returns {Promise<object>} El documento de configuración actualizado.
 */
export const upsertDefault = async (percent) => {
  const doc = await getOrInit();
  doc.defaultPercent = percent;
  const savedDoc = await doc.save();
  return savedDoc;
};

/**
 * Añade o actualiza una comisión específica para un par de divisas.
 * @param {string} originCurrency - Código de la moneda de origen.
 * @param {string} destCountry - Código del país de destino.
 * @param {number} percent - El porcentaje de comisión para este par.
 * @returns {Promise<object>} El documento de configuración actualizado.
 */
export const upsertPair = async (originCurrency, destCountry, percent) => {
  console.log(`[markupService] Iniciando upsertPair para ${originCurrency} -> ${destCountry} con ${percent}%`);
  try {
    const doc = await getOrInit();
    if (!doc) {
      throw new Error('No se pudo obtener o inicializar el documento de markup.');
    }

    doc.pairs = doc.pairs || [];

    const idx = doc.pairs.findIndex(p =>
      p.originCurrency.toUpperCase() === originCurrency.toUpperCase() &&
      p.destCountry.toUpperCase() === destCountry.toUpperCase()
    );

    if (idx >= 0) {
      console.log(`[markupService] Actualizando par existente en índice ${idx}`);
      doc.pairs[idx].percent = percent;
    } else {
      console.log(`[markupService] Añadiendo nuevo par`);
      doc.pairs.push({ originCurrency, destCountry, percent });
    }

    doc.markModified('pairs'); // Importante para arrays anidados

    console.log('[markupService] Intentando guardar el documento...');
    const savedDoc = await doc.save();

    console.log('[markupService] Documento después de save():', savedDoc ? 'Documento guardado' : 'Fallo el guardado');

    if (!savedDoc) {
      throw new Error('doc.save() no devolvió un documento. Fallo al guardar.');
    }

    console.log('[markupService] Documento guardado exitosamente. Devolviendo documento.');
    return savedDoc;

  } catch (error) {
     console.error('❌ [markupService] Error dentro de upsertPair:', error);
     throw error;
  }
};

// Exporta getOrInit si se usa en otros archivos, por ejemplo, en adminMarkup.js
export { getOrInit };