// Localization coverage: every player-facing English key used by the game has
// a translation in every shipped locale (regional tables inherit from their
// parent: en-GB → en-US, es-ES → es-419, fr-CA → fr-FR).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

function tables() {
  const sandbox = { self: {} };
  vm.runInNewContext(read('js/strings.js'), sandbox);
  return sandbox.self.BL_STRINGS;
}

/** Every English key the game passes through T(). */
export function usedKeys() {
  const keys = new Set();
  const add = (k) => { if (k && /[A-Za-z]/.test(k)) keys.add(k); };
  const unq = (s) => s.replace(/\\'/g, "'");
  for (const f of ['js/ui.js', 'js/main.js', 'js/platform.js']) {
    const src = read(f);
    for (const m of src.matchAll(/\bT\(\s*'((?:[^'\\]|\\.)*)'/g)) add(unq(m[1]));
    for (const m of src.matchAll(/'data-t(?:-aria)?':\s*'((?:[^'\\]|\\.)*)'/g)) add(unq(m[1]));
    for (const m of src.matchAll(/(?<![.\w])(?:slider|toggle|choice|stat)\(\s*'((?:[^'\\]|\\.)*)'/g)) add(unq(m[1]));
    for (const m of src.matchAll(/INVALID_TEXT\[[^\]]+\]\s*=\s*'((?:[^'\\]|\\.)*)'/g)) add(unq(m[1]));
    for (const m of src.matchAll(/kind === '\w+' \? '((?:[^'\\]|\\.)*)'/g)) add(unq(m[1]));
  }
  ['Practice', 'Journey', 'Challenge', 'Learn', 'Settings', 'Help', 'Profile', 'Scores', 'Results',
    'Global', 'Platform', 'Name', 'Score', 'Board', 'Time', 'easy', 'medium', 'hard',
    'Draw a line', 'Claim a box', 'Extra turns chain', 'The third side is a gift', 'Winning', 'Controls',
    'That move is not allowed.', 'Lesson complete', 'Time!', 'A tie!', 'Victory!', 'Defeat', 'A tie.', 'Defeat.',
    'Claims a box — draw again!', 'Risky: gives away a box', 'Safe line',
    'horizontal edge row {r} column {c}', 'vertical edge row {r} column {c}'].forEach(add);
  const Content = require('../js/content.js');
  Content.JOURNEY.forEach((l) => { add(l.name); add(l.intro); });
  Content.CHALLENGES.forEach((c) => { add(c.name); add(c.goalText); });
  Content.PRACTICE.forEach((p) => add(p.name));
  Content.THEMES.forEach((t) => add(t.name));
  Content.tutorialLessons().forEach((l) => { add(l.title); add(l.text); });
  add(Content.dailyConfig('2026-01-01').goalText);
  const Store = require('../js/store.js');
  Store.ACHIEVEMENTS.forEach((a) => { add(a.name); add(a.desc); });
  for (const m of read('js/rules.js').matchAll(/label: '((?:[^'\\]|\\.)*)'/g)) add(m[1]);
  return [...keys].sort();
}

test('every used key is translated in every full locale', () => {
  const T = tables();
  const missing = [];
  for (const loc of ['es-419', 'de-DE', 'fr-FR', 'pt-BR', 'it-IT']) {
    for (const k of usedKeys()) if (!T[loc] || !Object.prototype.hasOwnProperty.call(T[loc], k)) missing.push(loc + ': ' + k);
  }
  assert.deepEqual(missing, []);
});

test('placeholders survive translation; regional tables only override known keys', () => {
  const T = tables();
  const keys = new Set(usedKeys());
  const bad = [];
  for (const [loc, table] of Object.entries(T)) {
    for (const [k, v] of Object.entries(table)) {
      if (!keys.has(k)) { bad.push(loc + ' unused: ' + k); continue; }
      const want = (k.match(/\{\w+\}/g) || []).sort().join();
      const got = (String(v).match(/\{\w+\}/g) || []).sort().join();
      if (want !== got) bad.push(loc + ' placeholders: ' + k);
    }
  }
  for (const loc of ['en-GB', 'es-ES', 'fr-CA']) assert.ok(T[loc], loc + ' table');
  assert.deepEqual(bad, []);
});

test('i18n picks the locale through sh-language and re-renders on change', () => {
  const events = [];
  const doc = {
    documentElement: { lang: 'en' },
    dispatchEvent: (e) => events.push(e.detail.lang),
  };
  const sandbox = {
    self: {}, document: doc, location: { search: '' },
    navigator: { languages: ['de-DE'], language: 'de-DE' },
    localStorage: { getItem: () => null, setItem: () => {} },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o.detail; } },
    URLSearchParams,
  };
  sandbox.self = sandbox; sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('sh-language.js'), sandbox);

  vm.runInContext(read('js/strings.js'), sandbox);
  vm.runInContext(read('js/i18n.js'), sandbox);
  const I = sandbox.BLI18N;
  assert.equal(I.lang, 'de-DE');
  assert.equal(doc.documentElement.lang, 'de-DE');
  assert.equal(I.T('Pause'), 'Pause');
  assert.equal(I.T('Resume'), 'Fortsetzen');
  I.language.setChoice('fr-CA');
  assert.equal(I.lang, 'fr-CA');
  assert.equal(events.at(-1), 'fr-CA');
  assert.equal(I.T('Journey {n} — {name}', { n: 3, name: 'X' }).includes('3'), true);
});
