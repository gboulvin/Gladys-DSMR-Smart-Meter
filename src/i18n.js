// -----------------------------------------------------------------------------
// User-facing texts are multi-language objects (`en` mandatory): the Gladys
// core picks the user's language. The integration speaks English, French,
// German and Spanish.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** Build a multi-language text. */
export const t = (en, fr, de, es) => ({ en, fr, de, es });

/**
 * Format a number for the user's language, e.g. `1 234,5` in French.
 * @param {number} value
 * @param {string} language - Language of the user viewing the dashboard.
 * @param {number} [decimals]
 */
export function formatNumber(value, language, decimals = 0) {
  const locale = LANGUAGES.includes(language) ? language : 'en';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}
