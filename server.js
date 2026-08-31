/* ============================================================================
 * Boxes & Lines — StarHermit authoritative Game Script + static host.
 *
 * Zero-dependency Node.js server (run: `node server.js [--port N]`, env PORT,
 * default 8080). Serves the game files from the repo root and runs
 * authoritative game sessions with the same rules engine as the client
 * (require('./js/rules.js')). All API responses are JSON; structured
 * {"error":"..."} bodies are recoverable client states.
 *
 * API (all under /api/v1, JSON bodies capped at 64 KB):
 *   GET  /api/v1/time                     -> {"now": epochMs}  (clock sync)
 *   POST /api/v1/sessions                 -> 201 {sessionId, state, serverNow}
 *       body: {rows? 1..8, cols? 1..8, seed? uint32,
 *              aiLevel? 'easy'|'medium'|'hard', timeLimitSec? 0..3600}
 *       Creates a hosted match: human player 0 ("You") vs AI player 1.
 *   GET  /api/v1/sessions/:id             -> {sessionId, state, outcome, serverNow}
 *       Reconnect source of truth. 404 {"error":"no-session"}.
 *   POST /api/v1/sessions/:id/moves       -> {ok, events, state, outcome}
 *       body: {cmdId (string <=64, required), dir:'h'|'v', r, c}
 *       Errors: 404 no-session, 409 game-ended, 409 out-of-turn,
 *       422 {"error": reason} for illegal draws. Duplicate cmdId returns the
 *       stored result with "duplicate":true without re-applying (idempotent).
 *       After the human draw, AI replies are applied until it is the human's
 *       turn or the game ends; all events are returned in one array.
 *   POST /api/v1/sessions/:id/resign      -> {ok, state, outcome}
 *   POST /api/v1/scores                   -> 201 {ok, score, rank}
 *       body: {name?, board, cfg, commands, assists?, durationMs?, invalid?,
 *              sessionId?}. The server re-runs Rules.createGame(cfg) and
 *       replays every command; client score/time claims are ignored.
 *       422 stale-version (cfg.version != CONTENT_VERSION),
 *       422 impossible-score (illegal command or game not over).
 *   GET  /api/v1/scores?board=X           -> {board, entries: [top 50]}
 *       Sorted by score desc, invalid asc, durationMs asc, sessionId asc.
 *   Unknown /api route -> 404 {"error":"not-found"}; wrong method -> 405.
 *
 * Rate limiting: per-IP token bucket, 120 requests / 60s for /api/* only;
 * exceeded -> 429 {"error":"rate-limited"} with Retry-After header.
 * Sessions live in memory and expire 2h after lastSeen. Leaderboards keep at
 * most 500 entries per board (lowest dropped). Client clocks and scores are
 * never trusted; the server clock and replayed state are authoritative.
 * ==========================================================================*/
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const Rules = require('./js/rules.js');
const Content = require('./js/content.js');

const ROOT = __dirname;
const MAX_BODY = 64 * 1024;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const RATE_LIMIT = 120;          // requests
const RATE_WINDOW_MS = 60 * 1000;
const MAX_ENTRIES_PER_BOARD = 500;
const TOP_ENTRIES = 50;

// ---------- CLI / config ----------

function parsePort(argv) {
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--port') {
      const n = parseInt(argv[i + 1], 10);
      if (Number.isInteger(n) && n > 0 && n <= 65535) return n;
    }
  }
  const env = parseInt(process.env.PORT, 10);
  if (Number.isInteger(env) && env > 0 && env <= 65535) return env;
  return 8080;
}

// ---------- in-memory stores ----------

const sessions = new Map(); // id -> {state, lastSeen, lastAppliedCmdId, lastResult}
const boards = new Map();   // board name -> [entry]
const rateBuckets = new Map(); // ip -> {tokens, resetAt}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.lastSeen > SESSION_TTL_MS) sessions.delete(id);
  for (const [ip, b] of rateBuckets) if (now > b.resetAt) rateBuckets.delete(ip);
}, 60 * 1000).unref();

// ---------- helpers ----------

function sendJson(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  res.writeHead(code, headers);
  res.end(body);
}

function sendError(res, code, error, extraHeaders) {
  sendJson(res, code, { error: error }, extraHeaders);
}

function readBody(req, cb) {
  let size = 0;
  const chunks = [];
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      cb({ error: 'payload-too-large', code: 413 });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    let parsed = null;
    if (size > 0) {
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (e) {
        cb({ error: 'bad-json', code: 400 });
        return;
      }
    }
    cb(null, parsed);
  });
  req.on('error', () => cb({ error: 'bad-json', code: 400 }));
}

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function isUint32(v) { return Number.isInteger(v) && v >= 0 && v <= 0xFFFFFFFF; }

function rateLimited(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now > b.resetAt) {
    b = { tokens: RATE_LIMIT, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(ip, b);
  }
  if (b.tokens <= 0) return Math.ceil((b.resetAt - now) / 1000);
  b.tokens--;
  return 0;
}

// ---------- static files ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.opus': 'audio/ogg'
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/') rel = '/index.html';
  const resolved = path.resolve(ROOT, '.' + rel);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return notFound(res);
  const base = path.basename(resolved);
  if (base.startsWith('.')) return notFound(res);
  const mime = MIME[path.extname(resolved).toLowerCase()];
  if (!mime) return notFound(res);
  fs.stat(resolved, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': st.size });
    fs.createReadStream(resolved).pipe(res);
  });
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
}

// ---------- sessions ----------

const AI_LEVELS = ['easy', 'medium', 'hard'];

function createSession(body) {
  const rows = body.rows == null ? 4 : body.rows;
  const cols = body.cols == null ? 4 : body.cols;
  const seed = body.seed == null ? crypto.randomBytes(4).readUInt32BE(0) : body.seed;
  const aiLevel = body.aiLevel == null ? 'medium' : body.aiLevel;
  const timeLimitSec = body.timeLimitSec == null ? 0 : body.timeLimitSec;
  if (!Number.isInteger(rows) || rows < 1 || rows > 8) return { error: 'bad-rows' };
  if (!Number.isInteger(cols) || cols < 1 || cols > 8) return { error: 'bad-cols' };
  if (!isUint32(seed)) return { error: 'bad-seed' };
  if (AI_LEVELS.indexOf(aiLevel) < 0) return { error: 'bad-ai-level' };
  if (!Number.isInteger(timeLimitSec) || timeLimitSec < 0 || timeLimitSec > 3600) return { error: 'bad-time-limit' };

  const id = crypto.randomBytes(8).toString('hex');
  const cfg = {
    id: 'hosted-' + id,
    version: Rules.STATE_VERSION,
    kind: 'hosted',
    seed: seed,
    rows: rows,
    cols: cols,
    players: [
      { name: 'You', type: 'human' },
      { name: 'Rival', type: 'ai', ai: aiLevel }
    ],
    timeLimitSec: timeLimitSec,
    mechanics: { undo: false, hint: false },
    ranked: true
  };
  const state = Rules.createGame(cfg);
  sessions.set(id, { state: state, lastSeen: Date.now(), lastAppliedCmdId: null, lastResult: null });
  return { id: id, state: state };
}

function handleMoves(sess, body) {
  const state = sess.state;
  if (!isObj(body)) return { code: 400, error: 'bad-body' };
  const cmdId = body.cmdId;
  if (typeof cmdId !== 'string' || cmdId.length === 0 || cmdId.length > 64) return { code: 400, error: 'bad-cmd-id' };
  if (state.over) return { code: 409, error: 'game-ended' };
  if (state.current !== 0) return { code: 409, error: 'out-of-turn' };
  if (cmdId === sess.lastAppliedCmdId && sess.lastResult) {
    const dup = Rules.clone(sess.lastResult);
    dup.duplicate = true;
    return { code: 200, body: dup };
  }
  if (body.dir !== 'h' && body.dir !== 'v') return { code: 422, error: Rules.INVALID.BAD_SHAPE };
  const reason = Rules.checkDraw(state, body.dir, body.r, body.c);
  if (reason) return { code: 422, error: reason };

  const events = [];
  let res = Rules.applyCommand(state, { type: 'draw', dir: body.dir, r: body.r, c: body.c, player: 0, id: cmdId });
  if (!res.ok) return { code: 422, error: res.reason };
  events.push.apply(events, res.events);

  // AI replies until it is the human's turn or the game ends (bounded loop).
  let guard = 0;
  while (!state.over && state.current !== 0 && guard++ < 1000) {
    const p = state.players[state.current];
    if (p.type !== 'ai') break;
    const edge = Rules.aiMove(state, p.ai);
    if (!edge) break;
    res = Rules.applyCommand(state, { type: 'draw', dir: edge.dir, r: edge.r, c: edge.c, player: state.current });
    if (!res.ok) break; // should never happen; AI only picks legal edges
    events.push.apply(events, res.events);
  }

  const result = { ok: true, events: events, state: state, outcome: Rules.outcome(state) };
  sess.lastAppliedCmdId = cmdId;
  sess.lastResult = Rules.clone(result);
  return { code: 200, body: result };
}

// ---------- leaderboard ----------

function sortEntries(entries) {
  entries.sort((a, b) =>
    b.score - a.score ||
    a.invalid - b.invalid ||
    a.durationMs - b.durationMs ||
    (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
}

function handleSubmitScore(body) {
  if (!isObj(body)) return { code: 400, error: 'bad-body' };
  const board = body.board;
  const cfg = body.cfg;
  const commands = body.commands;
  if (typeof board !== 'string' || board.length === 0 || board.length > 64) return { code: 400, error: 'bad-board' };
  if (!isObj(cfg)) return { code: 400, error: 'bad-cfg' };
  if (!Array.isArray(commands) || commands.length > 10000) return { code: 400, error: 'bad-commands' };
  const name = typeof body.name === 'string' && body.name.length ? body.name.slice(0, 16) : 'Guest';
  const durationMs = Number.isInteger(body.durationMs) && body.durationMs >= 0 ? body.durationMs : 0;
  const invalid = Number.isInteger(body.invalid) && body.invalid >= 0 ? body.invalid : 0;
  const assists = body.assists === true;
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 64) : '';

  if (cfg.version !== Content.CONTENT_VERSION) return { code: 422, error: 'stale-version' };

  // Authoritative replay: re-run the game from cfg; client claims are ignored.
  let state;
  try {
    state = Rules.createGame(cfg);
    for (let i = 0; i < commands.length; i++) {
      const res = Rules.applyCommand(state, commands[i]);
      if (!res.ok) return { code: 422, error: 'impossible-score' };
    }
  } catch (e) {
    return { code: 422, error: 'impossible-score' };
  }
  if (!state.over) return { code: 422, error: 'impossible-score' };

  const score = Rules.scoreBreakdown(state, 0, durationMs).total;
  const entry = {
    name: name,
    score: score,
    board: board,
    seed: (cfg.seed == null ? 0 : cfg.seed) >>> 0,
    ruleset: String(cfg.kind || ''),
    contentVersion: cfg.version,
    assists: assists,
    durationMs: durationMs,
    invalid: invalid,
    sessionId: sessionId,
    at: Date.now()
  };
  let entries = boards.get(board);
  if (!entries) { entries = []; boards.set(board, entries); }
  entries.push(entry);
  sortEntries(entries);
  if (entries.length > MAX_ENTRIES_PER_BOARD) entries.length = MAX_ENTRIES_PER_BOARD;
  const rank = entries.indexOf(entry) + 1;
  return { code: 201, body: { ok: true, score: score, rank: rank } };
}

// ---------- router ----------

function handleApi(req, res, method, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api','v1',...]

  if (method === 'GET' && url.pathname === '/api/v1/time') {
    return sendJson(res, 200, { now: Date.now() });
  }

  if (url.pathname === '/api/v1/sessions') {
    if (method !== 'POST') return sendError(res, 405, 'method-not-allowed');
    return readBody(req, (err, body) => {
      if (err) return sendError(res, err.code, err.error);
      const created = createSession(body || {});
      if (created.error) return sendError(res, 400, created.error);
      sendJson(res, 201, { sessionId: created.id, state: created.state, serverNow: Date.now() });
    });
  }

  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'sessions' && parts.length >= 4) {
    const id = parts[3];
    const sess = sessions.get(id);
    if (parts.length === 4) {
      if (method !== 'GET') return sendError(res, 405, 'method-not-allowed');
      if (!sess) return sendError(res, 404, 'no-session');
      sess.lastSeen = Date.now();
      return sendJson(res, 200, { sessionId: id, state: sess.state, outcome: Rules.outcome(sess.state), serverNow: Date.now() });
    }
    if (parts.length === 5 && parts[4] === 'moves') {
      if (method !== 'POST') return sendError(res, 405, 'method-not-allowed');
      if (!sess) return sendError(res, 404, 'no-session');
      return readBody(req, (err, body) => {
        if (err) return sendError(res, err.code, err.error);
        sess.lastSeen = Date.now();
        const out = handleMoves(sess, body);
        if (out.error) return sendError(res, out.code, out.error);
        sendJson(res, out.code, out.body);
      });
    }
    if (parts.length === 5 && parts[4] === 'resign') {
      if (method !== 'POST') return sendError(res, 405, 'method-not-allowed');
      if (!sess) return sendError(res, 404, 'no-session');
      return readBody(req, (err) => {
        if (err) return sendError(res, err.code, err.error);
        sess.lastSeen = Date.now();
        if (!sess.state.over) Rules.applyCommand(sess.state, { type: 'resign', player: 0 });
        sendJson(res, 200, { ok: true, state: sess.state, outcome: Rules.outcome(sess.state) });
      });
    }
    return sendError(res, 404, 'not-found');
  }

  if (url.pathname === '/api/v1/scores') {
    if (method === 'GET') {
      const board = url.searchParams.get('board') || '';
      const entries = (boards.get(board) || []).slice(0, TOP_ENTRIES);
      return sendJson(res, 200, { board: board, entries: entries });
    }
    if (method !== 'POST') return sendError(res, 405, 'method-not-allowed');
    return readBody(req, (err, body) => {
      if (err) return sendError(res, err.code, err.error);
      const out = handleSubmitScore(body);
      if (out.error) return sendError(res, out.code, out.error);
      sendJson(res, out.code, out.body);
    });
  }

  return sendError(res, 404, 'not-found');
}

// ---------- server ----------

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const retryAfter = rateLimited(req.socket.remoteAddress || 'unknown');
      if (retryAfter > 0) {
        return sendError(res, 429, 'rate-limited', { 'Retry-After': String(retryAfter) });
      }
      return handleApi(req, res, req.method, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);
    serveStatic(req, res, url.pathname);
  } catch (e) {
    try { sendError(res, 500, 'internal'); } catch (e2) { /* socket gone */ }
  }
});

const port = parsePort(process.argv);
server.listen(port, () => {
  console.log('Boxes & Lines server listening at http://localhost:' + port + '/');
});
