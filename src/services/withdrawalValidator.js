import { getWithdrawalRules } from './vitaService.js'; // Usa import

// Usa 'export const' para exportar la función por su nombre
export const validateWithdrawalPayload = async (country, payload) => {
  try {
    const rules = await getWithdrawalRules();
    const countryRules = rules.rules[country]?.fields; // Accede a la estructura correcta

    if (!countryRules) {
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