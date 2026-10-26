// The engine save document and what the browser build (starhermit-sdk.js)
// left in the player's account (js/migrate.js): the checksummed cloud save
// read as a foreign save, progress merged across devices, settings carried
// over or dropped. Signed-in paths cannot run here, so their logic is tested.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Store = require('../js/store.js');
const Migrate = require('../js/migrate.js');

/** The browser build's cloud save text (Store.save's wrapper). */
function browserSave(doc) {
  const payload = JSON.stringify(doc);
  return JSON.stringify({ sum: Store.checksum(payload), payload });
}

test('the browser build cloud save is read: progress, name and settings', () => {
  const doc = Store.fresh();
  doc.progress.journeyStars.j01 = 3;
  doc.progress.stats.wins = 4;
  doc.profileName = 'Ada';
  doc.settings.captions = true;
  doc.settings.theme = 'kraft';
  doc.settings.music = 0.1;
  const got = Migrate.docFromBrowserSave(browserSave(doc));
  assert.equal(got.progress.journeyStars.j01, 3);
  assert.equal(got.profileName, 'Ada');
  assert.equal(Migrate.migrateSetting('captions', got.settings.captions), true);
  assert.equal(Migrate.migrateSetting('theme', got.settings.theme), 'kraft');
  assert.equal(Migrate.migrateSetting('music', got.settings.music), undefined, 'volumes are the runtime\'s now');
  assert.equal(Migrate.migrateSetting('theme', 'neon'), undefined);
  assert.equal(Migrate.docFromBrowserSave('{"sum":"x","payload":"{}"}'), null, 'a bad checksum is ignored');
  assert.equal(Migrate.docFromBrowserSave(null), null);
});

test('the old quality tier is dropped with the rest of the graphics settings', () => {
  assert.ok(Migrate.BROWSER_SETTING_KEYS.includes('graphicsTier'));
  assert.ok(Migrate.BROWSER_SETTING_KEYS.includes('ui.language'));
  assert.equal(Migrate.migrateSetting('graphics', { preset: 'high' }), undefined);
  for (const k of Migrate.GAME_SETTING_KEYS) assert.notEqual(Migrate.migrateSetting(k, Store.DEFAULT_SETTINGS[k]), undefined, k);
});

test('engine saves round-trip and merge the better of both devices', () => {
  const a = Store.fresh().progress, b = Store.fresh().progress;
  a.journeyStars = { j01: 2, j02: 1 }; a.achievements = { 'first-box': 500 }; a.stats.rounds = 7; a.tutorialDone = { L1: true };
  b.journeyStars = { j01: 3 }; b.achievements = { 'first-box': 200, 'first-win': 300 }; b.stats.rounds = 3; b.dailiesDone = { '2026-10-01': 900 };
  const saved = Migrate.saveDoc({ progress: a, profileName: 'Local' });
  const back = Migrate.fromSave(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(back.progress.journeyStars, a.journeyStars);
  assert.equal(back.profileName, 'Local');
  const m = Migrate.merge({ progress: b, profileName: 'Remote' }, back);
  assert.deepEqual(m.progress.journeyStars, { j01: 3, j02: 1 });
  assert.equal(m.progress.achievements['first-box'], 200, 'earliest unlock');
  assert.equal(m.progress.achievements['first-win'], 300);
  assert.equal(m.progress.stats.rounds, 7);
  assert.equal(m.progress.tutorialDone.L1, true);
  assert.equal(m.progress.dailiesDone['2026-10-01'], 900);
  assert.equal(m.profileName, 'Local', 'this device keeps its name');
  assert.equal(Migrate.merge({ progress: b, profileName: 'Remote' }, null).profileName, 'Remote');
  assert.equal(Migrate.fromSave({ v: 2, progress: a }), null);
  assert.equal(Migrate.fromSave(null), null);
});
