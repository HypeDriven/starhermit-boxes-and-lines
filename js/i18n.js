/* Boxes & Lines — localization.
 *
 * Nine locales: en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT.
 * English source strings are the keys; js/strings.js holds one table per
 * locale (en-GB, es-ES and fr-CA carry only their differences from en-US,
 * es-419 and fr-FR). The locale is the runtime's interface language
 * (native/i18n.ts calls setLocale with frame()'s / preferences().language,
 * the player's choice in Options › Language, else the account's or the
 * device's).
 * UMD: globalThis.BLI18N (loadClassic, after js/strings.js) / Node.
 */
(function (root, factory) {
  var S = (typeof module === 'object' && module.exports) ? require('./strings.js').BL_STRINGS : root.BL_STRINGS;
  var api = factory(S || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLI18N = api;
})(typeof self !== 'undefined' ? self : this, function (TABLES) {
  'use strict';

  var LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  var PARENT = { 'en-GB': 'en-US', 'es-ES': 'es-419', 'fr-CA': 'fr-FR' };
  var PRIMARY = { en: 'en-US', es: 'es-419', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT' };
  var lang = 'en-US';

  function lookup(key) {
    for (var l = lang; l; l = PARENT[l]) {
      var t = TABLES[l];
      if (t && Object.prototype.hasOwnProperty.call(t, key)) return t[key];
    }
    return key;
  }

  /** Translate an English source string; {name} placeholders filled from vars. */
  function T(key, vars) {
    var s = lookup(String(key));
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m; });
    return s;
  }

  /** The shipped locale nearest a BCP 47 tag (en-GB, es-ES and fr-CA by region). */
  function match(tag) {
    var t = String(tag || 'en-US');
    for (var i = 0; i < LOCALES.length; i++) if (LOCALES[i].toLowerCase() === t.toLowerCase()) return LOCALES[i];
    var base = t.split('-')[0].toLowerCase();
    if (base === 'en' && /-(gb|ie|au|nz|za|in)$/i.test(t)) return 'en-GB';
    if (base === 'es' && /-es$/i.test(t)) return 'es-ES';
    if (base === 'fr' && /-ca$/i.test(t)) return 'fr-CA';
    return PRIMARY[base] || 'en-US';
  }

  function setLocale(tag) { lang = match(tag); return lang; }

  return {
    T: T, match: match, setLocale: setLocale, LOCALES: LOCALES, tables: TABLES,
    get lang() { return lang; }
  };
});
