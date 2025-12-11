import { getWithdrawalRules } from './vitaService.js'; // Usa import

// Usa 'export const' para exportar la función por su nombre
export const validateWithdrawalPayload = async (country, payload) => {
  try {
    const rawData = await getWithdrawalRules();

    // 1. Normalización de estructura (igual que en la ruta)
    // Buscamos si las reglas están en .rules o son el objeto mismo
    let rulesMap = rawData.rules || rawData;

    // 2. Normalización de llaves a minúsculas
    const normalizedRules = {};
    if (rulesMap && typeof rulesMap === 'object') {
      Object.entries(rulesMap).forEach(([k, v]) => normalizedRules[k.toLowerCase()] = v);
    }

    const countryRules = normalizedRules[country.toLowerCase()]?.fields;

    if (!countryRules) {
      // Ignoramos error si no hay reglas, o retornamos error?
      // Si Vita no devuelve reglas para ese país, tal vez no requiera validación extra.
      // Pero mejor avisar.
      return { ok: false, errors: [`No se encontraron reglas de validación para el país: ${country}`] };
    }

    const errors = [];
    const visibleFields = countryRules.filter(field => {
      if (!field.when) return true;
      return payload[field.when.key] === field.when.value;
    });

    for (const rule of visibleFields) {
      const isRequired = rule.min > 0 || rule.required === true;
      if (isRequired && !payload[rule.key]) {
        errors.push(`Falta el campo obligatorio: ${rule.key}`);
      }
    }

    if (errors.length > 0) {
      return { ok: false, errors };
    }

    return { ok: true };
  } catch (error) {
    console.error('[withdrawalValidator] Error:', error);
    return { ok: false, errors: ['Error interno al validar el payload.'] };
  }
};