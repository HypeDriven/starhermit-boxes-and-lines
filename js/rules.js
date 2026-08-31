/* Boxes & Lines — pure deterministic rules engine.
 * No rendering, no DOM, no Date.now(): every transition derives from
 * (state, command) only. Usable from browser (window.BLRules) and Node.
 *
 * Core loop: the current player draws one undrawn edge between adjacent
 * dots. If that completes one or two boxes, the player claims them and
 * keeps the pencil (extra turn); otherwise play passes clockwise.
 * Most claimed boxes wins when the sheet is full.
 *
 * Board model for a rows×cols grid of boxes:
 *   he: (rows+1) × cols  horizontal edges, he[r][c]
 *   ve: rows × (cols+1)  vertical edges,   ve[r][c]
 *   cells: rows × cols, -1 unclaimed, -2 hole, ≥0 owner index
 * Edge values: 0 undrawn, -1 pre-drawn by setup, ≥1 drawn by player (v-1).
 */
(function (root, factory) {
  var RNG = (typeof module === 'object' && module.exports) ? require('./rng.js') : root.BLRNG;
  var api = factory(RNG);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLRules = api;
})(typeof self !== 'undefined' ? self : this, function (RNG) {
  'use strict';

  var STATE_VERSION = 1;

  var TERMINAL = {
    FULL: 'board-full',
    GOAL: 'goal-reached',
    RESIGN: 'resigned',
    TIME: 'time-up'
  };

  var INVALID = {
    ENDED: 'game-ended',
    DRAWN: 'edge-drawn',
    BOUNDS: 'out-of-bounds',
    BAD_CMD: 'unknown-command',
    BAD_SHAPE: 'malformed-command',
    WRONG_PLAYER: 'wrong-player'
  };

  // ---------- helpers ----------

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Stable stringify: object keys sorted recursively → canonical hashing.
  function stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) {
      var out = '[';
      for (var i = 0; i < v.length; i++) out += (i ? ',' : '') + stableStringify(v[i]);
      return out + ']';
    }
    var keys = Object.keys(v).sort(), s = '{';
    for (var k = 0; k < keys.length; k++) {
      s += (k ? ',' : '') + JSON.stringify(keys[k]) + ':' + stableStringify(v[keys[k]]);
    }
    return s + '}';
  }

  function hashState(state) {
    var copy = clone(state);
    delete copy.events;
    return RNG.hashString(stableStringify(copy));
  }

  function holeKey(r, c) { return r + ',' + c; }

  function isHole(state, r, c) { return !!state.holes[holeKey(r, c)]; }

  function edgeValue(state, dir, r, c) {
    return dir === 'h' ? state.he[r][c] : state.ve[r][c];
  }

  function edgeInBounds(state, dir, r, c) {
    if (!Number.isInteger(r) || !Number.isInteger(c)) return false;
    if (dir === 'h') return r >= 0 && r <= state.rows && c >= 0 && c < state.cols;
    if (dir === 'v') return r >= 0 && r < state.rows && c >= 0 && c <= state.cols;
    return false;
  }

  // Boxes touching an edge: list of [r, c].
  function boxesOfEdge(state, dir, r, c) {
    var out = [];
    if (dir === 'h') {
      if (r > 0) out.push([r - 1, c]);          // box above
      if (r < state.rows) out.push([r, c]);     // box below
    } else {
      if (c > 0) out.push([r, c - 1]);          // box left
      if (c < state.cols) out.push([r, c]);     // box right
    }
    return out;
  }

  // Number of drawn sides of box (r,c); extraEdge may be treated as drawn.
  function boxEdgeCount(state, r, c, extra) {
    var n = 0;
    if (state.he[r][c] !== 0 || (extra && extra.dir === 'h' && extra.r === r && extra.c === c)) n++;
    if (state.he[r + 1][c] !== 0 || (extra && extra.dir === 'h' && extra.r === r + 1 && extra.c === c)) n++;
    if (state.ve[r][c] !== 0 || (extra && extra.dir === 'v' && extra.r === r && extra.c === c)) n++;
    if (state.ve[r][c + 1] !== 0 || (extra && extra.dir === 'v' && extra.r === r && extra.c === c + 1)) n++;
    return n;
  }

  function openBox(state, r, c) {
    return r >= 0 && r < state.rows && c >= 0 && c < state.cols &&
      !isHole(state, r, c) && state.cells[r][c] === -1;
  }

  // ---------- game creation ----------

  // cfg: { id, version, kind, name, seed, rows, cols,
  //        players: [{name, type:'human'|'ai', ai:'easy'|'medium'|'hard'}],
  //        startPlayer, holes: [[r,c]], prefill (count of neutral edges),
  //        goal: {type:'first-to', target} | null,
  //        timeLimitSec, par: {timeSec} | null,
  //        mechanics: {undo, hint}, ranked, theme, intro }
  function normalizeCfg(cfg) {
    var c = clone(cfg);
    c.rows = c.rows || 4;
    c.cols = c.cols || 4;
    c.seed = (c.seed == null ? 1 : c.seed) >>> 0;
    c.players = c.players && c.players.length ? c.players :
      [{ name: 'You', type: 'human' }, { name: 'Rival', type: 'ai', ai: 'medium' }];
    c.startPlayer = c.startPlayer || 0;
    c.holes = c.holes || [];
    c.prefill = c.prefill || 0;
    c.goal = c.goal || null;
    c.timeLimitSec = c.timeLimitSec || 0;
    c.par = c.par || null;
    c.mechanics = Object.assign({ undo: false, hint: true }, c.mechanics || {});
    return c;
  }

  function createGame(cfg) {
    cfg = normalizeCfg(cfg);
    var rng = RNG.derive(cfg.seed, RNG.STREAM_RULES);
    var r, c;
    var he = [], ve = [], cells = [], holes = {};
    for (r = 0; r <= cfg.rows; r++) {
      var hrow = [];
      for (c = 0; c < cfg.cols; c++) hrow.push(0);
      he.push(hrow);
    }
    for (r = 0; r < cfg.rows; r++) {
      var vrow = [], crow = [];
      for (c = 0; c <= cfg.cols; c++) vrow.push(0);
      for (c = 0; c < cfg.cols; c++) crow.push(-1);
      ve.push(vrow); cells.push(crow);
    }
    cfg.holes.forEach(function (h) {
      if (h[0] >= 0 && h[0] < cfg.rows && h[1] >= 0 && h[1] < cfg.cols) {
        holes[holeKey(h[0], h[1])] = true;
        cells[h[0]][h[1]] = -2;
      }
    });
    var players = cfg.players.map(function (p) {
      return { name: String(p.name || 'Player'), type: p.type === 'ai' ? 'ai' : 'human', ai: p.ai || 'medium' };
    });
    var state = {
      v: STATE_VERSION,
      cfg: cfg,
      rows: cfg.rows, cols: cfg.cols,
      holes: holes,
      he: he, ve: ve, cells: cells,
      players: players,
      current: cfg.startPlayer % players.length,
      scores: players.map(function () { return 0; }),
      moves: players.map(function () { return 0; }),
      turn: 0,
      boxesLeft: cfg.rows * cfg.cols - Object.keys(holes).length,
      over: false, winner: -1, reason: null,
      rng: rng.state,
      events: []
    };
    // Neutral pre-drawn edges (never completing a box at setup).
    var tries = 0, placed = 0;
    while (placed < cfg.prefill && tries < cfg.prefill * 40 + 100) {
      tries++;
      var dir = rng.next() < 0.5 ? 'h' : 'v';
      var er = dir === 'h' ? rng.int(cfg.rows + 1) : rng.int(cfg.rows);
      var ec = dir === 'h' ? rng.int(cfg.cols) : rng.int(cfg.cols + 1);
      if (edgeValue(state, dir, er, ec) !== 0) continue;
      var completes = boxesOfEdge(state, dir, er, ec).some(function (b) {
        return openBox(state, b[0], b[1]) && boxEdgeCount(state, b[0], b[1]) === 3;
      });
      if (completes) continue;
      if (dir === 'h') state.he[er][ec] = -1; else state.ve[er][ec] = -1;
      placed++;
    }
    state.rng = rng.state;
    return state;
  }

  // ---------- legality ----------

  function legalActions(state) {
    var out = [], r, c;
    if (state.over) return out;
    for (r = 0; r <= state.rows; r++)
      for (c = 0; c < state.cols; c++)
        if (state.he[r][c] === 0) out.push({ dir: 'h', r: r, c: c });
    for (r = 0; r < state.rows; r++)
      for (c = 0; c <= state.cols; c++)
        if (state.ve[r][c] === 0) out.push({ dir: 'v', r: r, c: c });
    return out;
  }

  // Returns null when the draw is legal, otherwise an INVALID reason.
  function checkDraw(state, dir, r, c) {
    if (state.over) return INVALID.ENDED;
    if (!edgeInBounds(state, dir, r, c)) return INVALID.BOUNDS;
    if (edgeValue(state, dir, r, c) !== 0) return INVALID.DRAWN;
    return null;
  }

  // What a draw would do, without applying it: {claims:[[r,c]..], gives:bool}
  function previewDraw(state, dir, r, c) {
    var claims = [], gives = false;
    boxesOfEdge(state, dir, r, c).forEach(function (b) {
      if (!openBox(state, b[0], b[1])) return;
      var n = boxEdgeCount(state, b[0], b[1], { dir: dir, r: r, c: c });
      if (n === 4) claims.push([b[0], b[1]]);
      else if (n === 3) gives = true;
    });
    return { claims: claims, gives: gives };
  }

  // ---------- command application ----------

  function endGame(state, reason) {
    state.over = true;
    state.reason = reason;
    var best = -1, winner = -1, tied = false;
    state.scores.forEach(function (s, i) {
      if (s > best) { best = s; winner = i; tied = false; }
      else if (s === best) tied = true;
    });
    state.winner = tied ? -1 : winner;
    state.events.push({ type: 'over', reason: reason, winner: state.winner, scores: state.scores.slice() });
  }

  // cmd: { id?, type:'draw', dir, r, c, player? }
  //      { id?, type:'resign', player? }  { id?, type:'timeout', player? }
  // Returns { ok:true, events } or { ok:false, reason }. Invalid commands
  // never mutate state.
  function applyCommand(state, cmd) {
    state.events = [];
    if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string')
      return { ok: false, reason: INVALID.BAD_SHAPE };
    if (state.over) return { ok: false, reason: INVALID.ENDED };
    if (cmd.player != null && cmd.player !== state.current)
      return { ok: false, reason: INVALID.WRONG_PLAYER };

    if (cmd.type === 'resign') {
      state.turn++;
      state.events.push({ type: 'resign', player: state.current });
      endGame(state, TERMINAL.RESIGN);
      return { ok: true, events: state.events };
    }
    if (cmd.type === 'timeout') {
      state.turn++;
      state.events.push({ type: 'timeout', player: cmd.player != null ? cmd.player : state.current });
      endGame(state, TERMINAL.TIME);
      return { ok: true, events: state.events };
    }
    if (cmd.type !== 'draw') return { ok: false, reason: INVALID.BAD_CMD };

    var reason = checkDraw(state, cmd.dir, cmd.r, cmd.c);
    if (reason) return { ok: false, reason: reason };

    var p = state.current;
    if (cmd.dir === 'h') state.he[cmd.r][cmd.c] = p + 1;
    else state.ve[cmd.r][cmd.c] = p + 1;
    state.turn++;
    state.moves[p]++;

    var pv = previewDrawAfter(state, cmd.dir, cmd.r, cmd.c);
    state.events.push({ type: 'draw', dir: cmd.dir, r: cmd.r, c: cmd.c, player: p, gives: pv.gives, claims: pv.claims.length });

    pv.claims.forEach(function (b) {
      state.cells[b[0]][b[1]] = p;
      state.scores[p]++;
      state.boxesLeft--;
      state.events.push({ type: 'box', r: b[0], c: b[1], player: p, total: state.scores[p] });
    });

    if (pv.claims.length === 0) {
      state.current = (p + 1) % state.players.length;
      state.events.push({ type: 'pass', to: state.current });
    } else {
      state.events.push({ type: 'extra-turn', player: p });
    }

    var goal = state.cfg.goal;
    if (goal && goal.type === 'first-to' && state.scores[p] >= goal.target) {
      endGame(state, TERMINAL.GOAL);
      state.winner = p; // first-to is explicit, never a tie
      state.events[state.events.length - 1].winner = p;
    } else if (state.boxesLeft <= 0) {
      endGame(state, TERMINAL.FULL);
    }
    return { ok: true, events: state.events };
  }

  // Like previewDraw but for an edge that was just drawn.
  function previewDrawAfter(state, dir, r, c) {
    var claims = [], gives = false;
    boxesOfEdge(state, dir, r, c).forEach(function (b) {
      if (!openBox(state, b[0], b[1])) return;
      var n = boxEdgeCount(state, b[0], b[1]);
      if (n === 4) claims.push([b[0], b[1]]);
      else if (n === 3) gives = true;
    });
    return { claims: claims, gives: gives };
  }

  // ---------- AI (deterministic; uses the rules random stream) ----------

  // Estimated boxes the opponent could chain together after we draw `edge`.
  function chainOffer(state, edge) {
    var extra = edge;
    var visited = {}, total = 0;
    var stack = [];
    boxesOfEdge(state, edge.dir, edge.r, edge.c).forEach(function (b) {
      if (openBox(state, b[0], b[1]) && boxEdgeCount(state, b[0], b[1], extra) === 3)
        stack.push(b);
    });
    while (stack.length) {
      var b = stack.pop(), key = holeKey(b[0], b[1]);
      if (visited[key]) continue;
      visited[key] = true;
      total++;
      // Walk through every side of b that is still undrawn (after extra):
      // the box across it joins the chain when it has ≥2 sides drawn.
      var sides = [
        { dir: 'h', r: b[0], c: b[1], nb: [b[0] - 1, b[1]] },
        { dir: 'h', r: b[0] + 1, c: b[1], nb: [b[0] + 1, b[1]] },
        { dir: 'v', r: b[0], c: b[1], nb: [b[0], b[1] - 1] },
        { dir: 'v', r: b[0], c: b[1] + 1, nb: [b[0], b[1] + 1] }
      ];
      sides.forEach(function (s) {
        var drawn = edgeValue(state, s.dir, s.r, s.c) !== 0 ||
          (s.dir === edge.dir && s.r === edge.r && s.c === edge.c);
        if (drawn) return;
        var nr = s.nb[0], nc = s.nb[1];
        if (!openBox(state, nr, nc)) return;
        if (boxEdgeCount(state, nr, nc, extra) >= 2) stack.push([nr, nc]);
      });
    }
    return total;
  }

  // Pick an edge for the current player. difficulty: easy | medium | hard.
  function aiMove(state, difficulty) {
    var legal = legalActions(state);
    if (!legal.length) return null;
    var rng = RNG.create(state.rng);
    var pick = null;

    if (difficulty === 'easy') {
      pick = legal[rng.int(legal.length)];
    } else {
      var takers = [], safe = [], risky = [];
      legal.forEach(function (e) {
        var pv = previewDraw(state, e.dir, e.r, e.c);
        if (pv.claims.length) takers.push({ e: e, n: pv.claims.length });
        else if (!pv.gives) safe.push(e);
        else risky.push(e);
      });
      if (takers.length) {
        var bestN = Math.max.apply(null, takers.map(function (t) { return t.n; }));
        var bestT = takers.filter(function (t) { return t.n === bestN; });
        pick = bestT[rng.int(bestT.length)].e;
      } else if (safe.length) {
        pick = safe[rng.int(safe.length)];
      } else if (difficulty === 'hard') {
        // Forced to offer: open the smallest chain.
        var bestOffer = Infinity, bests = [];
        risky.forEach(function (e) {
          var offer = chainOffer(state, e);
          if (offer < bestOffer) { bestOffer = offer; bests = [e]; }
          else if (offer === bestOffer) bests.push(e);
        });
        pick = bests[rng.int(bests.length)];
      } else {
        pick = risky[rng.int(risky.length)];
      }
    }
    state.rng = rng.state; // persist stream position into the state
    return pick;
  }

  // Hint for a human: same search as the hard AI (same legal-action API).
  function suggest(state) {
    var saved = state.rng;
    var move = aiMove(state, 'hard');
    state.rng = saved; // hints must not consume the stream
    return move;
  }

  // ---------- results ----------

  function outcome(state) {
    return {
      over: state.over,
      winner: state.winner,
      draw: state.over && state.winner === -1,
      reason: state.reason,
      scores: state.scores.slice(),
      boxesTotal: state.rows * state.cols - Object.keys(state.holes).length
    };
  }

  // Integer score breakdown for results screens and leaderboards.
  // boxPoints: 100 per claimed box; win/margin/time/clean bonuses on top.
  function scoreBreakdown(state, playerIdx, elapsedMs) {
    var boxes = state.scores[playerIdx];
    var best = Math.max.apply(null, state.scores);
    var won = state.over && state.winner === playerIdx;
    var margin = boxes - Math.max.apply(null, state.scores.filter(function (_, i) { return i !== playerIdx; }).concat([0]));
    var parMs = state.cfg.par && state.cfg.par.timeSec ? state.cfg.par.timeSec * 1000 : 0;
    var components = [
      { key: 'boxes', label: 'Boxes claimed', points: boxes * 100 },
      { key: 'win', label: 'Victory', points: won ? 500 : 0 },
      { key: 'margin', label: 'Winning margin', points: won ? Math.max(0, margin) * 25 : 0 },
      { key: 'time', label: 'Under par time', points: won && parMs && elapsedMs < parMs ? Math.floor((parMs - elapsedMs) / 1000) * 5 : 0 }
    ];
    var total = components.reduce(function (s, c) { return s + c.points; }, 0);
    return { components: components, total: total, boxes: boxes, won: won, best: best, margin: margin };
  }

  // ---------- serialization ----------

  function serialize(state) { return JSON.stringify(state); }
  function deserialize(json) {
    var s = JSON.parse(json);
    if (!s || s.v !== STATE_VERSION) return null;
    s.events = [];
    return s;
  }

  return {
    STATE_VERSION: STATE_VERSION,
    TERMINAL: TERMINAL,
    INVALID: INVALID,
    createGame: createGame,
    normalizeCfg: normalizeCfg,
    legalActions: legalActions,
    checkDraw: checkDraw,
    previewDraw: previewDraw,
    applyCommand: applyCommand,
    aiMove: aiMove,
    suggest: suggest,
    chainOffer: chainOffer,
    outcome: outcome,
    scoreBreakdown: scoreBreakdown,
    boxesOfEdge: boxesOfEdge,
    boxEdgeCount: boxEdgeCount,
    edgeValue: edgeValue,
    isHole: isHole,
    serialize: serialize,
    deserialize: deserialize,
    clone: clone,
    stableStringify: stableStringify,
    hashState: hashState
  };
});
