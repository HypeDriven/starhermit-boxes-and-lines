/**
 * Boxes & Lines — server API checks (dev only, not shipped).
 *
 * Boots the real server.js on an ephemeral port and exercises the endpoints
 * that cannot be covered by the synchronous unit runner: hosted sessions and
 * the authoritative score replay.
 *
 * The key property under test: POST /api/v1/scores re-derives every AI move
 * from the seeded rules stream, so a *legal but fabricated* command log — one
 * where the rival plays to lose — cannot post a verified score.
 *
 * Run: npm run test:server   (or: node tests/server.test.mjs)
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Rules = require(path.join(ROOT, 'js/rules.js'));
const Session = require(path.join(ROOT, 'js/session.js'));
const Content = require(path.join(ROOT, 'js/content.js'));

let failures = 0;
async function step(name, fn) {
  try { await fn(); console.log('ok - ' + name); }
  catch (e) { failures++; console.log('FAIL - ' + name + '\n  ' + (e && e.message ? e.message : e)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function waitForServer(base, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(base + '/api/v1/time'); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

const api = (base) => async (method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed = null;
  try { parsed = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, body: parsed };
};

// A genuine playthrough: the human plays greedily, the AI is the real engine.
function honestGame() {
  const s = Session.create(Content.JOURNEY[1], 'journey');
  for (let guard = 0; !s.state.over && guard < 5000; guard++) {
    if (s.state.players[s.state.current].type === 'ai') { Session.aiStep(s); continue; }
    const legal = Rules.legalActions(s.state);
    const pick = legal.find((e) => Rules.previewDraw(s.state, e.dir, e.r, e.c).claims.length) ||
      legal.find((e) => !Rules.previewDraw(s.state, e.dir, e.r, e.c).gives) || legal[0];
    Session.apply(s, { type: 'draw', dir: pick.dir, r: pick.r, c: pick.c, player: s.state.current, id: 'c' + guard });
  }
  return s;
}

// A legal-but-fabricated log: every command applies cleanly, but the rival
// never plays the move the deterministic AI would have chosen.
function forgedGame() {
  const state = Rules.createGame(Content.JOURNEY[1]);
  const log = [];
  for (let guard = 0; !state.over && guard < 5000; guard++) {
    const legal = Rules.legalActions(state);
    const pv = (e) => Rules.previewDraw(state, e.dir, e.r, e.c);
    const pick = state.current === 0
      ? (legal.find((e) => pv(e).claims.length) || legal.find((e) => !pv(e).gives) || legal[0])
      : (legal.find((e) => pv(e).gives) || legal.find((e) => !pv(e).claims.length) || legal[0]);
    const cmd = { type: 'draw', dir: pick.dir, r: pick.r, c: pick.c, player: state.current };
    const res = Rules.applyCommand(state, cmd);
    assert(res.ok, 'forged log produced an illegal command: ' + res.reason);
    log.push(cmd);
  }
  return { cfg: state.cfg, log, scores: state.scores };
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port', String(port)], { stdio: 'ignore' });
const call = api(base);

try {
  await waitForServer(base);

  await step('GET /api/v1/time returns a server clock', async () => {
    const r = await call('GET', '/api/v1/time');
    assert(r.status === 200, 'status ' + r.status);
    assert(Number.isFinite(r.body.now), 'no now field');
  });

  await step('unknown API routes 404 with a structured error', async () => {
    const r = await call('GET', '/api/v1/nope');
    assert(r.status === 404 && r.body.error === 'not-found', JSON.stringify(r));
  });

  await step('hosted session: create, move, reconnect, resign', async () => {
    const created = await call('POST', '/api/v1/sessions', { rows: 3, cols: 3, seed: 42, aiLevel: 'medium' });
    assert(created.status === 201, 'create status ' + created.status);
    const id = created.body.sessionId;

    const first = Rules.legalActions(created.body.state)[0];
    const moved = await call('POST', `/api/v1/sessions/${id}/moves`,
      { cmdId: 'm1', dir: first.dir, r: first.r, c: first.c });
    assert(moved.status === 200 && moved.body.ok, JSON.stringify(moved));
    assert(moved.body.state.current === 0 || moved.body.state.over, 'server did not hand the turn back');

    const dup = await call('POST', `/api/v1/sessions/${id}/moves`,
      { cmdId: 'm1', dir: first.dir, r: first.r, c: first.c });
    assert(dup.status === 200 && dup.body.duplicate === true, 'replayed cmdId was not idempotent');

    const again = await call('POST', `/api/v1/sessions/${id}/moves`,
      { cmdId: 'm2', dir: first.dir, r: first.r, c: first.c });
    assert(again.status === 422, 'redrawing a drawn edge should be rejected, got ' + again.status);

    const got = await call('GET', `/api/v1/sessions/${id}`);
    assert(got.status === 200 && got.body.sessionId === id, 'reconnect failed');

    const resigned = await call('POST', `/api/v1/sessions/${id}/resign`, {});
    assert(resigned.status === 200 && resigned.body.outcome.over, 'resign did not end the match');

    const missing = await call('GET', '/api/v1/sessions/deadbeef');
    assert(missing.status === 404 && missing.body.error === 'no-session', JSON.stringify(missing));
  });

  await step('an honest playthrough posts a verified score', async () => {
    const s = honestGame();
    assert(s.state.over, 'honest game did not finish');
    const r = await call('POST', '/api/v1/scores',
      { name: 'QA', board: 'test', cfg: s.cfg, commands: s.log, durationMs: 1000 });
    assert(r.status === 201 && r.body.ok, JSON.stringify(r));
    assert(r.body.score > 0, 'verified score should be positive');
  });

  await step('a fabricated log with a losing rival is rejected', async () => {
    const f = forgedGame();
    assert(f.scores[0] > f.scores[1], 'forged log should favour the human');
    const r = await call('POST', '/api/v1/scores',
      { name: 'Forger', board: 'test', cfg: f.cfg, commands: f.log, durationMs: 1000 });
    assert(r.status === 422 && r.body.error === 'impossible-score', JSON.stringify(r));
  });

  await step('unfinished and stale-version submissions are rejected', async () => {
    const s = honestGame();
    const short = await call('POST', '/api/v1/scores',
      { name: 'QA', board: 'test', cfg: s.cfg, commands: s.log.slice(0, 2), durationMs: 10 });
    assert(short.status === 422 && short.body.error === 'impossible-score', JSON.stringify(short));

    const stale = await call('POST', '/api/v1/scores',
      { name: 'QA', board: 'test', cfg: { ...s.cfg, version: Content.CONTENT_VERSION + 1 }, commands: s.log });
    assert(stale.status === 422 && stale.body.error === 'stale-version', JSON.stringify(stale));
  });

  await step('leaderboard returns the posted entries', async () => {
    const r = await call('GET', '/api/v1/scores?board=test');
    assert(r.status === 200 && Array.isArray(r.body.entries), JSON.stringify(r));
    assert(r.body.entries.length >= 1, 'expected at least one verified entry');
    assert(r.body.entries.every((e) => e.name !== 'Forger'), 'a forged entry reached the board');
  });

  await step('static files are served and dotfiles are not', async () => {
    const index = await fetch(base + '/');
    assert(index.status === 200, 'index status ' + index.status);
    assert((await index.text()).includes('<title>'), 'index.html was not served');
    const hidden = await fetch(base + '/.gitignore');
    assert(hidden.status === 404, 'dotfile served: ' + hidden.status);
    const escape = await fetch(base + '/../package.json');
    assert(escape.status === 404, 'path traversal served: ' + escape.status);
  });
} finally {
  child.kill();
}

console.log(failures ? `SERVER TESTS FAILED: ${failures}` : 'SERVER TESTS PASSED');
process.exitCode = failures ? 1 : 0;
