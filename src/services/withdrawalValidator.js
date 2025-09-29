// backend/src/services/withdrawalValidator.js
// Fuente Vita: GET /api/businesses/withdrawal_rules
// Justificación: validar payload antes de enviarlo a Vita, según reglas dinámicas.

const { getWithdrawalRules } = require('./vitaService');

async function validateWithdrawalPayload(countryKey, payload) {
  const rulesResponse = await getWithdrawalRules();
  const rules = rulesResponse?.rules?.[countryKey];
  if (!rules) {
    return { ok: false, errors: [`No hay reglas configuradas para ${countryKey}`] };
  }

  const errors = [];
  const fields = rules.fields || [];

  for (const field of fields) {
    const value = payload[field.key];

    // ⚡ Evaluar condiciones "when"
    if (field.when) {
      const whenKey = field.when.key;
      const whenValue = field.when.value.toLowerCase();
      const actual = String(payload[whenKey] || '').toLowerCase();
      if (actual !== whenValue) {
        // Si la condición no se cumple, saltamos esta validación
        continue;
      }
    }

    // Validar obligatoriedad
    if (!value || value === '') {
      errors.push(`Falta el campo obligatorio: ${field.key}`);
      continue;
    }

    // Validar selects
    if (field.type === 'select' && Array.isArray(field.options)) {
      const validOptions = field.options.map(o => o.value.toLowerCase());
      if (!validOptions.includes(String(value).toLowerCase())) {
        errors.push(`El campo ${field.key} debe ser uno de: ${validOptions.join(', ')}`);
      }
    }

    // Validar longitudes
    if (field.type === 'text' || field.type === 'email') {
      if (field.min && String(value).length < field.min) {
        errors.push(`El campo ${field.key} debe tener al menos ${field.min} caracteres`);
      }
      if (field.max && String(value).length > field.max) {
        errors.push(`El campo ${field.key} debe tener máximo ${field.max} caracteres`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

module.exports = { validateWithdrawalPayload };