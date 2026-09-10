/**
 * Boxes & Lines — end-to-end QA playthrough (dev only, not shipped).
 *
 * Drives the REAL VISIBLE UI in headless Chrome via playwright-core:
 * title → journey stage 1 played to a results screen (clicking the on-screen
 * button-board edges, plus keyboard arrows+Enter once) → hint, pause/resume,
 * results breakdown → practice sheet with undo → settings from pause →
 * lesson 1 (Learn) → settings from title. Two passes: desktop 1280×800 and
 * mobile 390×844 (touch), each in a fresh browser context.
 *
 * The repo's server.js is a StarHermit authoritative game script — this test
 * instead embeds a minimal node:http static server (ephemeral port). All
 * local modes (journey, practice, learn, challenge, daily) run fully offline;
 * only "Hosted play" needs the real backend and is intentionally not covered.
 * /api/* requests are answered 404 so the client's offline fallback path runs.
 *
 * Run: npm run test:e2e   (or: node tests/e2e.mjs)
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, tag) => `/tmp/boxes-and-lines-e2e-${stage}-${tag}.png`;

// Benign headless-GPU noise (from tools/production_game_audit.mjs).
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.ts': 'video/mp2t',
  '.txt': 'text/plain; charset=utf-8',
};

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{"error":"not-found"}');
        return;
      }
      let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
      if (p === '/' || p === '\\') p = '/index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT)) throw new Error('forbidden');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---- shared page helpers --------------------------------------------------

const overlayVisible = (page) =>
  page.evaluate(() => !document.getElementById('screen-overlay').hidden);
const screenName = (page) =>
  page.evaluate(() => document.getElementById('screen-title').textContent);
const resultsShown = async (page) =>
  (await overlayVisible(page)) && (await screenName(page)) === 'Results';
const turnText = (page) =>
  page.evaluate(() => document.getElementById('turn-indicator').textContent.trim());
const drawnCount = (page) =>
  page.locator('#board-mirror .edge-btn.drawn').count();

async function waitHumanOrOver(page, timeout = 20000) {
  await page.waitForFunction(() => {
    const t = document.getElementById('turn-indicator').textContent.trim();
    return t === 'Your turn' || t === 'Sheet complete';
  }, null, { timeout });
}

async function drawFirstFreeEdge(page) {
  await page.locator('#board-mirror .edge-btn:not([disabled])').first().click();
  await page.waitForTimeout(220);
}

// Rebuild the sheet from the visible button-board (each edge's aria-label and
// drawn/disabled state are on-screen UI) and pick a competent move: claim a
// box if possible, otherwise avoid handing the rival a third side.
async function pickSmartEdge(page) {
  return page.evaluate(() => {
    const edges = [];
    for (const b of document.querySelectorAll('#board-mirror .edge-btn')) {
      const m = b.getAttribute('aria-label').match(/^(horizontal|vertical) edge row (\d+) column (\d+)/);
      if (!m) continue;
      edges.push({ dir: m[1] === 'horizontal' ? 'h' : 'v', r: +m[2] - 1, c: +m[3] - 1, drawn: b.disabled });
    }
    const rows = Math.max(...edges.filter((e) => e.dir === 'v').map((e) => e.r)) + 1;
    const cols = Math.max(...edges.filter((e) => e.dir === 'h').map((e) => e.c)) + 1;
    const he = Array.from({ length: rows + 1 }, () => Array(cols).fill(false));
    const ve = Array.from({ length: rows }, () => Array(cols + 1).fill(false));
    edges.forEach((e) => { if (e.drawn) (e.dir === 'h' ? he : ve)[e.r][e.c] = true; });
    const sides = (r, c) => (he[r][c] ? 1 : 0) + (he[r + 1][c] ? 1 : 0) + (ve[r][c] ? 1 : 0) + (ve[r][c + 1] ? 1 : 0);
    const boxesOf = (e) => e.dir === 'h'
      ? [[e.r - 1, e.c], [e.r, e.c]].filter(([r, c]) => r >= 0 && r < rows && c < cols)
      : [[e.r, e.c - 1], [e.r, e.c]].filter(([r, c]) => r >= 0 && c >= 0 && c < cols);
    const free = edges.filter((e) => !e.drawn);
    const claims = free.filter((e) => boxesOf(e).some(([r, c]) => sides(r, c) === 3));
    const safe = free.filter((e) => !boxesOf(e).some(([r, c]) => sides(r, c) === 2));
    const pick = claims[0] || safe[0] || free[0];
    return pick ? (pick.dir === 'h' ? 'horizontal' : 'vertical') +
      ' edge row ' + (pick.r + 1) + ' column ' + (pick.c + 1) : null;
  });
}

async function drawSmartEdge(page) {
  const label = await pickSmartEdge(page);
  if (!label) throw new Error('no free edge on the button board');
  await page.locator(`#board-mirror .edge-btn[aria-label="${label}"]`).click();
  await page.waitForTimeout(220);
}

async function clickCard(page, title) {
  await page.locator('.card', { hasText: title }).first().click();
}

// ---- the playthrough ------------------------------------------------------

async function playthrough(page, tag, errors) {
  const step = async (name, fn) => {
    await fn();
    console.log(`ok - [${tag}] ${name}`);
  };

  await step('load → title screen with mode cards', async () => {
    await page.waitForFunction(() =>
      !document.getElementById('screen-overlay').hidden &&
      document.getElementById('screen-title').textContent === 'Boxes & Lines', null, { timeout: 15000 });
    const cards = await page.locator('.card').count();
    if (cards < 6) throw new Error(`expected >=6 mode cards, got ${cards}`);
    await page.screenshot({ path: SHOT('title', tag) });
  });

  await step('journey stage 1 starts from the primary Play card', async () => {
    await page.locator('.card.primary-card').click();
    await page.waitForFunction(() => document.getElementById('screen-overlay').hidden);
    const edges = await page.locator('#board-mirror .edge-btn:not([disabled])').count();
    if (edges < 10) throw new Error(`expected a fresh 2x3 sheet, got ${edges} free edges`);
    const objective = await page.evaluate(() => document.getElementById('objective-text').textContent);
    if (!objective) throw new Error('no objective text in HUD');
    await page.screenshot({ path: SHOT('journey-start', tag) });
  });

  await step('hint button highlights a suggested edge', async () => {
    await waitHumanOrOver(page);
    await page.click('#btn-hint');
    await page.waitForSelector('#board-mirror .edge-btn.hinted', { timeout: 3000 });
    await page.screenshot({ path: SHOT('hint', tag) });
  });

  await step('keyboard arrows + Enter draw a line', async () => {
    await waitHumanOrOver(page);
    const before = await drawnCount(page);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(120);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const after = await drawnCount(page);
    if (after <= before) throw new Error(`keyboard draw had no effect (${before} -> ${after})`);
  });

  await step('pause → resume via HUD buttons', async () => {
    await page.click('#btn-pause');
    await page.waitForFunction(() => !document.getElementById('pause-overlay').hidden);
    await page.screenshot({ path: SHOT('pause', tag) });
    await page.click('#btn-resume');
    await page.waitForFunction(() => document.getElementById('pause-overlay').hidden);
  });

  await step('play journey sheet to completion via the button board', async () => {
    for (let i = 0; i < 120; i++) {
      if (await resultsShown(page)) break;
      await waitHumanOrOver(page);
      if ((await turnText(page)) === 'Sheet complete') break;
      await drawSmartEdge(page);
      if (i === 2) await page.screenshot({ path: SHOT('midgame', tag) });
    }
    await page.waitForFunction(() =>
      !document.getElementById('screen-overlay').hidden &&
      document.getElementById('screen-title').textContent === 'Results', null, { timeout: 15000 });
    if ((await drawnCount(page)) < 17) throw new Error('sheet ended before all 17 edges were drawn');
  });

  await step('results screen shows outcome and score breakdown', async () => {
    const headline = await page.locator('#screen-body h2').first().textContent();
    if (!/Victory|Defeat|tie|Time/i.test(headline)) throw new Error('unexpected headline: ' + headline);
    console.log(`  [${tag}] headline:`, headline.trim());
    const rows = await page.locator('#screen-body table.breakdown tr').count();
    if (rows < 2) throw new Error(`expected breakdown rows, got ${rows}`);
    const saved = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('boxesandlines.save.v1') || 'null');
      return raw && raw.payload ? JSON.parse(raw.payload) : null;
    });
    if (!saved || saved.progress.stats.rounds < 1) {
      throw new Error('completed round was not persisted to the save doc');
    }
    await page.screenshot({ path: SHOT('results', tag) });
  });

  // Regression: "← Back" out of Results used to leave the player on a dead
  // board with no reachable menu (pause and Escape are both inert once the
  // sheet is over).
  await step('back out of results returns to a usable title screen', async () => {
    await page.click('#screen-back');
    await page.waitForFunction(() => document.getElementById('screen-title').textContent === 'Boxes & Lines');
    const stranded = await page.evaluate(() => ({
      overlayHidden: document.getElementById('screen-overlay').hidden,
      backVisible: !document.getElementById('screen-back').hidden,
      hud: document.getElementById('turn-indicator').textContent,
    }));
    if (stranded.overlayHidden) throw new Error('title dialog closed onto a finished board');
    if (stranded.backVisible) throw new Error('back button still offered on the title with no sheet in play');
    if (stranded.hud !== '') throw new Error('finished sheet was not torn down: ' + stranded.hud);
    await page.keyboard.press('Escape'); // must not close the title onto a dead board
    await page.waitForTimeout(150);
    if (await page.evaluate(() => document.getElementById('screen-overlay').hidden)) {
      throw new Error('Escape closed the title screen with no sheet in play');
    }
  });

  await step('practice sheet: undo restores the position', async () => {
    if ((await screenName(page)) !== 'Boxes & Lines') {
      await page.locator('#screen-body .btn', { hasText: 'Title' }).click();
      await page.waitForFunction(() => document.getElementById('screen-title').textContent === 'Boxes & Lines');
    }
    await clickCard(page, 'Practice');
    await page.waitForFunction(() => document.getElementById('screen-title').textContent === 'Practice');
    await page.locator('#screen-body .btn.primary.big').click();
    await page.waitForFunction(() => document.getElementById('screen-overlay').hidden);
    await waitHumanOrOver(page);
    await drawFirstFreeEdge(page);
    await waitHumanOrOver(page); // wait out the AI reply
    const before = await drawnCount(page);
    const undoDisabled = await page.evaluate(() => document.getElementById('btn-undo').disabled);
    if (undoDisabled) throw new Error('undo disabled after a practice move');
    await page.click('#btn-undo');
    await page.waitForTimeout(250);
    const after = await drawnCount(page);
    if (after >= before) throw new Error(`undo did not restore (${before} -> ${after})`);
    await page.screenshot({ path: SHOT('practice-undo', tag) });
  });

  await step('settings from pause apply and resume works', async () => {
    await page.click('#btn-pause');
    await page.waitForFunction(() => !document.getElementById('pause-overlay').hidden);
    await page.click('#btn-pause-settings');
    await page.waitForFunction(() =>
      !document.getElementById('screen-overlay').hidden &&
      document.getElementById('screen-title').textContent === 'Settings');
    await page.locator('.setting-row input[type="checkbox"][aria-label="High contrast"]').click();
    await page.waitForFunction(() => document.body.classList.contains('high-contrast'));
    await page.screenshot({ path: SHOT('settings', tag) });
    await page.keyboard.press('Escape'); // consumed by Settings, must not also resume
    await page.waitForFunction(() =>
      document.getElementById('screen-overlay').hidden && !document.getElementById('pause-overlay').hidden);
    await page.click('#btn-resume');
    await page.waitForFunction(() => document.getElementById('pause-overlay').hidden);
  });

  await step('leave sheet → back at title', async () => {
    await page.click('#btn-pause');
    await page.waitForFunction(() => !document.getElementById('pause-overlay').hidden);
    await page.click('#btn-leave');
    await page.waitForFunction(() =>
      !document.getElementById('screen-overlay').hidden &&
      document.getElementById('screen-title').textContent === 'Boxes & Lines');
  });

  await step('learn lesson 1 completes with a results screen', async () => {
    await clickCard(page, 'Learn');
    await page.waitForFunction(() => document.getElementById('screen-title').textContent === 'Learn');
    await page.locator('#screen-body .level-row').first().click();
    await page.waitForFunction(() => document.getElementById('screen-overlay').hidden);
    for (let i = 0; i < 20 && !(await resultsShown(page)); i++) {
      await waitHumanOrOver(page);
      await drawFirstFreeEdge(page);
    }
    if (!(await resultsShown(page))) throw new Error('lesson 1 did not reach results');
    const headline = await page.locator('#screen-body h2').first().textContent();
    if (!/Lesson complete/i.test(headline)) throw new Error('unexpected lesson headline: ' + headline);
    await page.screenshot({ path: SHOT('lesson', tag) });
    await page.locator('#screen-body .btn', { hasText: 'Title' }).click();
    await page.waitForFunction(() => document.getElementById('screen-title').textContent === 'Boxes & Lines');
  });

  await step('settings screen from title opens and closes', async () => {
    await page.locator('.title-links .btn', { hasText: 'Settings' }).click();
    await page.waitForFunction(() => document.getElementById('screen-title').textContent === 'Settings');
    const rows = await page.locator('.setting-row').count();
    if (rows < 10) throw new Error(`expected settings rows, got ${rows}`);
    await page.keyboard.press('Escape'); // Escape is the dialog's back action
    await page.waitForFunction(() => document.getElementById('screen-title').textContent === 'Boxes & Lines');
    await page.screenshot({ path: SHOT('title-final', tag) });
  });

  const bad = errors.filter((e) => !browserNoise.test(e));
  if (bad.length) throw new Error('page errors during pass:\n' + bad.join('\n'));
}

// ---- runner ---------------------------------------------------------------

const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}/`;
let browser = null;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });

  for (const pass of [
    { tag: 'desktop', opts: { viewport: { width: 1280, height: 800 } } },
    { tag: 'mobile', opts: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ]) {
    const errors = [];
    const context = await browser.newContext(pass.opts);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const url = m.location()?.url || '';
      // offline fallback: the embedded server answers /api/* with 404
      if (url.includes('/api/') && /Failed to load resource/.test(m.text())) return;
      errors.push(`console: ${m.text()} (${url})`);
    });
    try {
      await page.goto(base, { waitUntil: 'load', timeout: 30000 });
      await playthrough(page, pass.tag, errors);
    } finally {
      await context.close();
    }
  }

  console.log('\nE2E PASS — desktop + mobile, no page errors');
} finally {
  if (browser) await browser.close();
  server.close();
}
