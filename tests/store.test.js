/* Boxes & Lines — persistence tests (js/store.js). Uses shimmed localStorage. */
'use strict';
var H = require('./helpers.js');
var Store = require('../js/store.js');
var test = H.test, eq = H.eq, ok = H.ok;

// Independent FNV-1a (base-36) reimplementation for cross-checking.
function fnv(str) {
  var h = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

test('checksum stable and matches independent FNV-1a', function () {
  ['', 'a', 'hello', 'boxes-and-lines', '{"v":1}'].forEach(function (s) {
    eq(Store.checksum(s), fnv(s), 'checksum(' + JSON.stringify(s) + ')');
  });
  eq(Store.checksum('hello'), Store.checksum('hello'), 'deterministic');
  ok(Store.checksum('hello') !== Store.checksum('hellp'), 'sensitive to input');
});

test('save/load round-trip via shimmed localStorage', function () {
  localStorage.clear();
  var doc = Store.fresh();
  doc.settings.music = 0.1;
  doc.progress.journeyStars.j01 = 3;
  Store.save(doc);
  var loaded = Store.load();
  eq(loaded.settings.music, 0.1);
  eq(loaded.progress.journeyStars.j01, 3);
  eq(loaded.v, Store.SAVE_VERSION);
});

test('corrupt checksum → load returns fresh', function () {
  localStorage.clear();
  var doc = Store.fresh();
  doc.settings.music = 0.123;
  Store.save(doc);
  var raw = JSON.parse(localStorage.getItem('boxesandlines.save.v1'));
  raw.sum = 'deadbeef'; // corrupt
  localStorage.setItem('boxesandlines.save.v1', JSON.stringify(raw));
  var loaded = Store.load();
  eq(loaded.settings.music, Store.DEFAULT_SETTINGS.music, 'fresh defaults after corruption');
  eq(loaded.progress.journeyStars, {}, 'fresh progress after corruption');
});

test('migrate fills missing fields, rejects future version', function () {
  var partial = { v: 1, settings: { music: 0.3 }, progress: { journeyStars: { j02: 2 } } };
  var m = Store.migrate(partial);
  ok(m, 'migrate ok');
  eq(m.settings.music, 0.3, 'preserved');
  eq(m.settings.effects, Store.DEFAULT_SETTINGS.effects, 'missing settings filled');
  eq(m.progress.journeyStars.j02, 2, 'progress preserved');
  eq(m.progress.stats.rounds, 0, 'missing stats filled');
  ok(m.progress.cosmetics && m.progress.achievements, 'missing progress maps filled');
  eq(Store.migrate({ v: Store.SAVE_VERSION + 1 }), null, 'v > SAVE_VERSION rejected');
  eq(Store.migrate(null), null);
  eq(Store.migrate(42), null);
});

test('sortEntries tie order: score desc → invalid asc → durationMs asc → sessionId asc', function () {
  var entries = [
    { sessionId: 'b', score: 100, invalid: 2, durationMs: 5000 },
    { sessionId: 'a', score: 300, invalid: 9, durationMs: 9000 }, // highest score wins despite worse ties
    { sessionId: 'z', score: 100, invalid: 1, durationMs: 8000 }, // fewer invalid beats b
    { sessionId: 'y', score: 100, invalid: 1, durationMs: 3000 }, // lower duration beats z
    { sessionId: 'x', score: 100, invalid: 1, durationMs: 3000 }, // ties with y → sessionId asc
    { sessionId: 'c', score: 50,  invalid: 0, durationMs: 100 }
  ];
  var sorted = Store.sortEntries(entries);
  eq(sorted.map(function (e) { return e.sessionId; }), ['a', 'x', 'y', 'z', 'b', 'c']);
  eq(entries[0].sessionId, 'b', 'input array not mutated');
});

test('migrate maps the old quality tier to a graphics preset and copies graphics settings', function () {
  var m = Store.migrate({ v: 1, settings: { graphicsTier: 'medium' } });
  eq(m.settings.graphics, { preset: 'balanced' });
  ok(!('graphicsTier' in m.settings), 'old key dropped');
  eq(Store.migrate({ v: 1, settings: { graphicsTier: 'auto' } }).settings.graphics, {});
  var g = { preset: 'high', bloom: 'off' };
  var m2 = Store.migrate({ v: 1, settings: { graphicsTier: 'low', graphics: g } });
  eq(m2.settings.graphics, { preset: 'high', bloom: 'off' }, 'saved graphics win over the old tier');
  var f1 = Store.fresh(), f2 = Store.fresh();
  f1.settings.graphics.preset = 'ultra';
  eq(f2.settings.graphics, {}, 'fresh docs do not share the graphics object');
  eq(Store.DEFAULT_SETTINGS.graphics, {}, 'defaults untouched');
});

test('mergeProgress keeps the better of both devices on a cloud-save conflict', function () {
  var local = Store.fresh(), remote = Store.fresh();
  local.settings.theme = 'kraft';
  local.progress.journeyStars = { j01: 3, j02: 1 };
  remote.progress.journeyStars = { j02: 2, j03: 1 };
  local.progress.tutorialDone = { L1: true };
  remote.progress.tutorialDone = { L2: true };
  local.progress.achievements = { 'first-win': 200 };
  remote.progress.achievements = { 'first-win': 100, 'first-box': 50 };
  local.progress.dailiesDone = { '2026-01-01': 900 };
  remote.progress.dailiesDone = { '2026-01-01': 1200, '2026-01-02': 400 };
  local.progress.stats.rounds = 5; remote.progress.stats.rounds = 9;
  local.progress.stats.bestChain = 6; remote.progress.stats.bestChain = 2;
  var m = Store.mergeProgress(local, remote);
  eq(m.progress.journeyStars, { j02: 2, j03: 1, j01: 3 });
  eq(m.progress.tutorialDone, { L2: true, L1: true });
  eq(m.progress.achievements, { 'first-win': 100, 'first-box': 50 });
  eq(m.progress.dailiesDone, { '2026-01-01': 1200, '2026-01-02': 400 });
  eq(m.progress.stats.rounds, 9);
  eq(m.progress.stats.bestChain, 6);
  eq(m.settings.theme, 'kraft', 'this device keeps its settings');
});
