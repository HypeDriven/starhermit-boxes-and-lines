/* Boxes & Lines — the save document of the engine client and what the
 * browser build (starhermit-sdk.js) left in the player's account, as the
 * engine client takes it over (pure: no storage).
 *  - The engine save (starhermit:storage `saves`) is { v: 1, progress,
 *    profileName }: the browser build's progress document (BLStore) and the
 *    offline display name, merged across devices by BLStore.mergeProgress
 *    (higher stars and bests, every lesson, the earliest unlock of every
 *    achievement, the larger lifetime counters).
 *  - The browser build's cloud save (slot game:<slug>) holds the SDK's
 *    save.json: the checksummed { sum, payload } wrapper of the whole
 *    document { v, settings, progress, profileName }. The engine shows it as
 *    a foreign save; docFromBrowserSave reads it, its progress is merged in
 *    and its game settings are kept where this account has none yet.
 *  - The per-player settings keys (the SDK's PATCH of the settings object):
 *    the game's own options carry over as game settings; volumes, mute,
 *    graphics, reduced motion, contrast, larger text and the language are the
 *    runtime's Options now and are dropped.
 * UMD: globalThis.BLMigrate (loadClassic, after js/store.js) / Node.
 */
(function (root, factory) {
  var S = (typeof module === 'object' && module.exports) ? require('./store.js') : root.BLStore;
  var api = factory(S);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLMigrate = api;
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  function bool(v) { return typeof v === 'boolean'; }
  /** Settings the game still owns (game.<key> in the runtime's settings), with their checks. */
  var GAME_SETTINGS = {
    captions: bool,
    theme: function (v) { return typeof v === 'string' && /^(graphite|blueprint|kraft|midnight|rosewood)$/.test(v); },
    colorPalette: function (v) { return v === 'standard' || v === 'high-visibility'; },
    leftHanded: bool,
    haptics: bool,
    boardMirror: bool,
    confirmMoves: bool
  };
  var GAME_SETTING_KEYS = Object.keys(GAME_SETTINGS);
  /** Every key the browser build kept in the account's per-player settings. */
  var BROWSER_SETTING_KEYS = Object.keys(S.DEFAULT_SETTINGS).concat(['graphicsTier', 'ui.language']);

  function isProgress(p) {
    return !!(p && typeof p === 'object' && !Array.isArray(p) && p.stats && typeof p.stats === 'object');
  }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  /** { progress, profileName } in an engine save document, or null. */
  function fromSave(doc) {
    if (!doc || typeof doc !== 'object' || doc.v !== 1 || !isProgress(doc.progress)) return null;
    var m = S.migrate({ v: 1, progress: copy(doc.progress) });
    return { progress: m.progress, profileName: typeof doc.profileName === 'string' ? doc.profileName : '' };
  }

  /** The whole browser-build document ({ v, settings, progress, profileName }) in its cloud save text, or null. */
  function docFromBrowserSave(text) {
    if (typeof text !== 'string') return null;
    return S.loadRaw(text);
  }

  /** The engine save document. */
  function saveDoc(data) {
    var out = { v: 1, progress: data.progress };
    if (data.profileName) out.profileName = data.profileName;
    return out;
  }

  /** Two { progress, profileName } merged (either may be null): `local`'s name wins. */
  function merge(remote, local) {
    if (!local && !remote) return { progress: S.fresh().progress, profileName: '' };
    if (!local) return { progress: copy(remote.progress), profileName: remote.profileName || '' };
    var doc = { progress: copy(local.progress), profileName: local.profileName || '' };
    if (remote) S.mergeProgress(doc, { progress: copy(remote.progress), profileName: remote.profileName || '' });
    return { progress: doc.progress, profileName: doc.profileName || '' };
  }

  /** A browser-build setting's value as the engine client keeps it, or undefined (dropped). */
  function migrateSetting(key, value) {
    var check = GAME_SETTINGS[key];
    if (!check) return undefined;
    return check(value) ? value : undefined;
  }

  return {
    GAME_SETTING_KEYS: GAME_SETTING_KEYS, BROWSER_SETTING_KEYS: BROWSER_SETTING_KEYS,
    fromSave: fromSave, docFromBrowserSave: docFromBrowserSave,
    saveDoc: saveDoc, merge: merge, migrateSetting: migrateSetting
  };
});
