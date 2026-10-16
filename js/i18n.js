/* Boxes & Lines — localization.
 *
 * Nine locales: en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT.
 * English source strings are the keys; js/strings.js holds one table per
 * locale (en-GB, es-ES and fr-CA carry only their differences from en-US,
 * es-419 and fr-FR). The locale comes from the game's Language setting
 * through sh-language.js (explicit choice → StarHermit account preference →
 * navigator.languages → en-US); ?lang= forces one for the page load (QA).
 * Changing the language updates document.documentElement.lang and fires
 * `bl-language` so every screen re-renders in place.
 * Browser global: window.BLI18N (T is also exposed as window.BLT).
 */
(function (root) {
  'use strict';

  var LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  var PARENT = { 'en-GB': 'en-US', 'es-ES': 'es-419', 'fr-CA': 'fr-FR' };
  var TABLES = root.BL_STRINGS || {};
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

  function setLocale(next) {
    lang = LOCALES.indexOf(next) >= 0 ? next : 'en-US';
    document.documentElement.lang = lang;
    document.dispatchEvent(new CustomEvent('bl-language', { detail: { lang: lang } }));
  }

  var forced = null;
  try { forced = new URLSearchParams(root.location.search).get('lang'); } catch (e) { /* opaque origin */ }
  var SL = root.StarHermitLanguage;
  var forcedLocale = forced && SL ? SL.match(forced, LOCALES) : null;
  var language = SL ? SL.create({
    game: 'boxes-and-lines', supported: LOCALES, panel: !forcedLocale,
    apply: function (locale) { setLocale(forcedLocale || locale); }
  }) : null;
  if (!language) setLocale('en-US');

  root.BLT = T;
  root.BLI18N = {
    T: T,
    get lang() { return lang; },
    locales: LOCALES,
    language: language,
    tables: TABLES
  };
})(typeof self !== 'undefined' ? self : this);
