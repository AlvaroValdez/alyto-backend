// backend/src/services/withdrawalValidator.js
import { getWithdrawalRules } from './vitaService.js';

function isEmptyValue(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  return false;
}

function pickRulesContainer(payload) {
  // intenta ubicar el objeto "rules" en distintos shapes comunes
  return (
    payload?.rules ||
    payload?.data?.rules ||
    payload?.withdrawal_rules?.rules ||
    payload?.withdrawal_rules?.data?.rules ||
    null
  );
}

function getCountryEntryCaseInsensitive(rulesObj, countryKey) {
  if (!rulesObj || typeof rulesObj !== 'object') return null;

  // busca la key real en rulesObj (CO vs co vs Co)
  const entryKey = Object.keys(rulesObj).find(
    (k) => String(k).toUpperCase() === countryKey
  );

  if (!entryKey) return null;
  return rulesObj[entryKey] || null;
}

export const validateWithdrawalPayload = async (country, payload) => {
  try {
    const countryKey = String(country || '').toUpperCase().trim();
    const rulesPayload = await getWithdrawalRules();

    const rulesObj = pickRulesContainer(rulesPayload);

    // Debug controlado para ver qué keys trae Vita realmente
    if ((process.env.VITA_DEBUG_RULES || 'false').toLowerCase() === 'true') {
      const keys = rulesObj && typeof rulesObj === 'object' ? Object.keys(rulesObj) : [];
      console.log('[withdrawalValidator] rulesObj keys sample:', keys.slice(0, 25));
      console.log('[withdrawalValidator] countryKey:', countryKey);
    }

    const entry = getCountryEntryCaseInsensitive(rulesObj, countryKey);

    // fields puede venir como entry.fields o entry.data.fields según la API
    const countryFields =
      entry?.fields ||
      entry?.data?.fields ||
      entry?.rules?.fields ||
      null;

    if (!Array.isArray(countryFields) || countryFields.length === 0) {
      return {
        ok: false,
        errors: [`No se encontraron reglas para el país: ${countryKey}`],
        allowedKeys: []
      };
    }

    const visibleFields = countryFields.filter((field) => {
      if (!field?.key) return false;
      if (!field.when) return true;

      const wKey = field.when.key;
      const wVal = field.when.value;

      return payload?.[wKey] === wVal;
    });

    const errors = [];

    for (const rule of visibleFields) {
      if (rule.required === true && isEmptyValue(payload?.[rule.key])) {
        errors.push(`Falta el campo obligatorio: ${rule.key}`);
      }
    }

    const allowedKeys = visibleFields.map((f) => f.key);

    if (errors.length > 0) {
      return { ok: false, errors, allowedKeys };
    }

    return { ok: true, allowedKeys };
  } catch (error) {
    console.error('[withdrawalValidator] Error:', error?.message || error);
    return { ok: false, errors: ['Error interno al validar el payload.'], allowedKeys: [] };
  }
};
