import Markup from '../models/Markup.js';

const getOrInit = async () => {
  let doc = await Markup.findOne();
  if (!doc) {
    console.log('[markupService] No se encontró documento de markup, creando uno nuevo...');
    doc = await Markup.create({ defaultPercent: 3, pairs: [] });
    console.log('[markupService] Nuevo documento de markup creado.');
  }
  return doc;
};

export const getPercent = async (origin, dest) => {
  try {
    const markupConfig = await getOrInit();
    const specificPair = markupConfig.pairs.find(p =>
      p.originCurrency.toUpperCase() === origin.toUpperCase() &&
      p.destCountry.toUpperCase() === dest.toUpperCase()
    );
    if (specificPair) {
      console.log(`✅ [markupService] Markup específico encontrado para ${origin}→${dest}: ${specificPair.percent}%.`);
      return specificPair.percent;
    }
    const defaultMarkup = markupConfig.defaultPercent || 0;
    console.log(`✅ [markupService] Usando markup por defecto: ${defaultMarkup}%.`);
    return defaultMarkup;
  } catch (error) {
    console.error('❌ [markupService] Error al obtener el markup:', error);
    return 0;
  }
};

export const upsertDefault = async (percent) => {
  const doc = await getOrInit();
  doc.defaultPercent = percent;
  const savedDoc = await doc.save();
  return savedDoc;
};

// --- FUNCIÓN upsertPair CORREGIDA ---
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
    
    // Marca la ruta 'pairs' como modificada (importante para arrays anidados)
    doc.markModified('pairs'); 

    console.log('[markupService] Intentando guardar el documento...');
    const savedDoc = await doc.save(); 
    
    if (!savedDoc) {
      throw new Error('doc.save() no devolvió un documento. Fallo al guardar.');
    }
    
    console.log('[markupService] Documento guardado exitosamente. Devolviendo documento.');
    return savedDoc; // <-- ESTA LÍNEA ES LA CORRECCIÓN

  } catch (error) {
     console.error('❌ [markupService] Error dentro de upsertPair:', error);
     throw error;
  }
};

export { getOrInit };