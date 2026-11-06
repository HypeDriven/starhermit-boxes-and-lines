// Localization coverage: every player-facing English key the engine client
// (native/*.ts) and the content use has a translation in every shipped locale
// (regional tables inherit from their parent: en-GB → en-US, es-ES → es-419,
// fr-CA → fr-FR) and placeholders survive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const tables = () => JSON.parse(read('assets/strings.json'));

/** Every English key the game passes through T(), or names for it. */
export function usedKeys() {
  const keys = new Set();
  const add = (k) => { if (k && /[A-Za-z]/.test(k)) keys.add(k); };
  const unq = (s) => s.replace(/\\(["'])/g, '$1');
  const lit = String.raw`(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')`;
  const grab = (src, re) => { for (const m of src.matchAll(re)) add(unq(m[1] ?? m[2] ?? '')); };
  for (const f of readdirSync(new URL('native/', ROOT)).filter((n) => n.endsWith('.ts'))) {
    const src = read('native/' + f);
    grab(src, new RegExp(String.raw`\bT\(\s*` + lit, 'g'));
    // settings rows, help card titles, stat labels, screen titles, headlines, invalid texts, captions
    grab(src, new RegExp(String.raw`(?:check|select)\(\s*"\w+",\s*` + lit, 'g'));
    grab(src, new RegExp(String.raw`^\s*\[` + lit + String.raw`,\s*(?:T\(|String)`, 'gm'));
    grab(src, new RegExp(String.raw`INVALID_TEXT\[[^\]]+\]\s*=\s*` + lit, 'g'));
    grab(src, new RegExp(String.raw`(?:headline|kind === "\w+") \? ` + lit, 'g'));
    grab(src, new RegExp(String.raw`: ` + lit + String.raw`(?=[,;)])`, 'g'));
  }
  // The values of a few tables keyed by id.
  for (const m of read('native/screens.ts').match(/SCREEN_TITLES[^}]+}/)[0].matchAll(/: "([^"]+)"/g)) add(m[1]);
  for (const m of read('native/audio.ts').match(/CAPTIONS[^}]+}/)[0].matchAll(/: "([^"]+)"/g)) add(m[1]);
  ['Global', 'Platform', '#', 'Name', 'Score', 'Board', 'Time', 'easy', 'medium', 'hard', 'Draw a line', 'Claim a box',
    'Extra turns chain', 'The third side is a gift', 'Winning', 'Controls', 'Lesson complete', 'Time!', 'A tie!', 'Victory!', 'Defeat',
    'Matches', 'Wins', 'Boxes claimed', 'Best chain', 'Journey stars', 'Time played',
    // ternaries and fallbacks inside T(…)
    'Claim the most boxes', 'horizontal edge row {r} column {c}', 'vertical edge row {r} column {c}', 'That move is not allowed.',
    'A tie.', 'Victory!', 'Defeat.', 'Player {id}'].forEach(add);
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
  // Not text: game names, glyphs, ids and style classes the patterns catch.
  for (const k of [...keys]) if (k === 'Boxes & Lines' || k.startsWith('starhermit.') || !/[a-z]{2}/.test(k) || /^[a-z0-9-]+$/.test(k) && !/^(easy|medium|hard|select|undo|hint|paused|chain!|platform|timed|locked)$/.test(k) || /^\$|^#|\.(js|ts|webp|json|opus)$|^rgba\(|^starhermit:|^\w+:\w/.test(k)) keys.delete(k);
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

