/* Boxes & Lines — rules engine tests (js/rules.js). */
'use strict';
var H = require('./helpers.js');
var Rules = require('../js/rules.js');
var RNG = require('../js/rng.js');
var test = H.test, eq = H.eq, ok = H.ok;

function cfg2p(extra) {
  return Object.assign({
    id: 't', version: 1, seed: 42, rows: 2, cols: 2,
    players: [{ name: 'A', type: 'human' }, { name: 'B', type: 'human' }]
  }, extra || {});
}
function draw(s, dir, r, c) { return Rules.applyCommand(s, { type: 'draw', dir: dir, r: r, c: c }); }

// ---------- createGame ----------
test('createGame shapes: he/ve/cells dimensions', function () {
  var s = Rules.createGame(cfg2p());
  eq(s.he.length, 3); eq(s.he[0].length, 2);
  eq(s.ve.length, 2); eq(s.ve[0].length, 3);
  eq(s.cells.length, 2); eq(s.cells[0].length, 2);
  eq(s.boxesLeft, 4);
  eq(s.over, false); eq(s.winner, -1); eq(s.reason, null);
  eq(s.scores, [0, 0]);
});

test('createGame holes become -2 and reduce boxesLeft', function () {
  var s = Rules.createGame(cfg2p({ rows: 3, cols: 3, holes: [[0, 0], [2, 2], [9, 9]] }));
  eq(s.cells[0][0], -2); eq(s.cells[2][2], -2);
  eq(s.boxesLeft, 7); // out-of-range hole ignored
  ok(Rules.isHole(s, 0, 0) && !Rules.isHole(s, 1, 1), 'isHole');
});

test('createGame prefill never completes a box at setup', function () {
  for (var seed = 1; seed <= 20; seed++) {
    var s = Rules.createGame(cfg2p({ seed: seed, rows: 3, cols: 3, prefill: 6 }));
    eq(s.boxesLeft, 9, 'boxesLeft unchanged by prefill');
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++)
      ok(Rules.boxEdgeCount(s, r, c) < 4, 'no completed box at setup seed ' + seed);
  }
});

// ---------- legality ----------
test('legalActions fresh 2x2 = 12 edges', function () {
  var s = Rules.createGame(cfg2p());
  eq(Rules.legalActions(s).length, 12);
});

test('checkDraw reasons: DRAWN, BOUNDS, ENDED', function () {
  var s = Rules.createGame(cfg2p());
  eq(Rules.checkDraw(s, 'h', 0, 0), null);
  draw(s, 'h', 0, 0);
  eq(Rules.checkDraw(s, 'h', 0, 0), Rules.INVALID.DRAWN);
  eq(Rules.checkDraw(s, 'h', 99, 0), Rules.INVALID.BOUNDS);
  eq(Rules.checkDraw(s, 'h', -1, 0), Rules.INVALID.BOUNDS);
  eq(Rules.checkDraw(s, 'v', 0, 1.5), Rules.INVALID.BOUNDS); // non-integer
  eq(Rules.checkDraw(s, 'x', 0, 0), Rules.INVALID.BOUNDS);
  var g = Rules.createGame(cfg2p());
  Rules.applyCommand(g, { type: 'resign' });
  eq(Rules.checkDraw(g, 'h', 0, 0), Rules.INVALID.ENDED);
  eq(Rules.legalActions(g).length, 0, 'no legal actions after end');
});

// ---------- full game flow (scripted 1x2, player 0 claims both) ----------
function script1x2(extraCfg) {
  var s = Rules.createGame(cfg2p(Object.assign({ rows: 1, cols: 2 }, extraCfg || {})));
  var seq = [['h', 0, 0], ['h', 0, 1], ['h', 1, 0], ['h', 1, 1], ['v', 0, 0], ['v', 0, 2]];
  seq.forEach(function (e) { ok(draw(s, e[0], e[1], e[2]).ok, 'setup draw'); });
  return s;
}

test('full game flow: claims, extra turn, events, board-full, winner', function () {
  var s = script1x2();
  eq(s.current, 0); // 6 passes → back to player 0
  var res = draw(s, 'v', 0, 1); // completes both boxes
  ok(res.ok, 'final draw ok');
  eq(s.scores, [2, 0]);
  eq(s.cells, [[0, 0]], 'both cells owned by player 0');
  eq(s.boxesLeft, 0);
  eq(s.over, true);
  eq(s.reason, 'board-full');
  eq(s.winner, 0);
  var types = res.events.map(function (e) { return e.type; });
  ['draw', 'box', 'extra-turn', 'over'].forEach(function (t) {
    ok(types.indexOf(t) >= 0, 'event ' + t + ' present');
  });
  eq(types.filter(function (t) { return t === 'box'; }).length, 2, 'two box events');
  var over = res.events[res.events.length - 1];
  eq(over.type, 'over'); eq(over.reason, 'board-full'); eq(over.winner, 0);
});

// ---------- extra-turn rule ----------
test('extra turn keeps current; non-completing draw passes (mod players)', function () {
  var s = Rules.createGame(cfg2p({
    players: [{ name: 'A', type: 'human' }, { name: 'B', type: 'human' }, { name: 'C', type: 'human' }]
  }));
  eq(s.current, 0);
  draw(s, 'h', 0, 0); eq(s.current, 1, 'pass 0→1');
  draw(s, 'h', 1, 0); eq(s.current, 2, 'pass 1→2');
  draw(s, 'v', 0, 0); eq(s.current, 0, 'pass 2→0 (mod 3)');
  draw(s, 'v', 0, 1); // completes box (0,0)
  eq(s.current, 0, 'completing draw keeps the pencil');
  eq(s.scores[0], 1);
});

// ---------- first-to goal ----------
test('first-to goal ends with goal-reached and explicit winner', function () {
  var s = script1x2({ goal: { type: 'first-to', target: 2 } });
  var res = draw(s, 'v', 0, 1);
  ok(res.ok);
  eq(s.over, true);
  eq(s.reason, 'goal-reached');
  eq(s.winner, 0);
  eq(s.boxesLeft, 0);
});

// ---------- resign / timeout / invalid commands ----------
test('resign and timeout end with correct reasons', function () {
  var g1 = Rules.createGame(cfg2p());
  var r1 = Rules.applyCommand(g1, { type: 'resign' });
  ok(r1.ok); eq(g1.reason, 'resigned'); eq(g1.over, true);
  var g2 = Rules.createGame(cfg2p());
  var r2 = Rules.applyCommand(g2, { type: 'timeout' });
  ok(r2.ok); eq(g2.reason, 'time-up'); eq(g2.over, true);
});

test('wrong player, malformed, unknown command; no state mutation', function () {
  var s = Rules.createGame(cfg2p());
  draw(s, 'h', 0, 0); // current now 1
  var before = Rules.hashState(s);
  var r = Rules.applyCommand(s, { type: 'draw', dir: 'h', r: 0, c: 1, player: 0 });
  eq(r.ok, false); eq(r.reason, Rules.INVALID.WRONG_PLAYER);
  eq(Rules.applyCommand(s, {}).reason, Rules.INVALID.BAD_SHAPE);
  eq(Rules.applyCommand(s, null).reason, Rules.INVALID.BAD_SHAPE);
  eq(Rules.applyCommand(s, { type: 'nope' }).reason, Rules.INVALID.BAD_CMD);
  eq(Rules.applyCommand(s, { type: 'draw', dir: 'h', r: 0, c: 0 }).reason, Rules.INVALID.DRAWN);
  eq(Rules.hashState(s), before, 'invalid commands never mutate state');
});

// ---------- scoreBreakdown ----------
test('scoreBreakdown components sum; winner bonuses; loser none', function () {
  var s = script1x2({ par: { timeSec: 60 } });
  draw(s, 'v', 0, 1);
  var w = Rules.scoreBreakdown(s, 0, 10000); // 10s < 60s par
  eq(w.components.reduce(function (t, c) { return t + c.points; }, 0), w.total, 'components sum to total');
  eq(w.components[0].points, 200, 'boxes*100');
  eq(w.components[1].points, 500, 'win bonus');
  eq(w.components[2].points, 50, 'margin 2*25');
  eq(w.components[3].points, 250, 'time bonus (60-10)*5');
  eq(w.total, 1000);
  var l = Rules.scoreBreakdown(s, 1, 10000);
  eq(l.total, 0, 'loser: no boxes/win/margin/time points');
  var slow = Rules.scoreBreakdown(s, 0, 70000); // over par
  eq(slow.components[3].points, 0, 'no time bonus when over par');
  eq(slow.total, 750);
});

// ---------- serialization ----------
test('serialize/deserialize round-trip; wrong version rejected', function () {
  var s = script1x2();
  draw(s, 'v', 0, 1);
  var back = Rules.deserialize(Rules.serialize(s));
  ok(back, 'deserialize ok');
  eq(Rules.hashState(back), Rules.hashState(s), 'hashState equal after round-trip');
  eq(back.scores, [2, 0]); eq(back.over, true);
  var tampered = JSON.parse(Rules.serialize(s));
  tampered.v = 999;
  eq(Rules.deserialize(JSON.stringify(tampered)), null, 'wrong version → null');
});

// ---------- determinism property test ----------
test('determinism: 30 seeds × 3 sizes, identical hashes; suggest stream-safe', function () {
  var sizes = [[1, 2], [2, 2], [3, 3]];
  for (var seed = 1; seed <= 30; seed++) {
    sizes.forEach(function (sz) {
      var cfg = cfg2p({
        seed: seed * 1000 + sz[0] * 10 + sz[1], rows: sz[0], cols: sz[1],
        players: [{ name: 'A', type: 'ai', ai: 'medium' }, { name: 'B', type: 'ai', ai: 'hard' }],
        prefill: 2
      });
      var s1 = Rules.createGame(cfg), s2 = Rules.createGame(cfg);
      eq(Rules.hashState(s1), Rules.hashState(s2), 'initial hash equal');
      var driver = RNG.create((seed * 7919) >>> 0); // test-side stream, same for both
      var checkpoints = [3, 6, 9, 12, 15], checked = 0;
      for (var step = 0; step < 500 && !s1.over; step++) {
        var useAI = driver.next() < 0.5;
        var diff = ['easy', 'medium', 'hard'][driver.int(3)];
        var m1 = useAI ? Rules.aiMove(s1, diff) : Rules.legalActions(s1)[driver.int(Rules.legalActions(s1).length)];
        ok(m1, 'move exists');
        var m2;
        if (useAI) {
          m2 = Rules.aiMove(s2, diff);
        } else {
          Rules.legalActions(s2).forEach(function (e) {
            if (e.dir === m1.dir && e.r === m1.r && e.c === m1.c) m2 = e;
          });
        }
        ok(m2, 'mirrored move exists');
        var a = draw(s1, m1.dir, m1.r, m1.c), b = draw(s2, m2.dir, m2.r, m2.c);
        ok(a.ok && b.ok, 'both draws ok');
        if (checkpoints.indexOf(step + 1) >= 0) {
          eq(Rules.hashState(s1), Rules.hashState(s2), 'checkpoint hash @' + (step + 1));
          checked++;
        }
      }
      eq(s1.over, true, 'game terminates');
      eq(Rules.hashState(s1), Rules.hashState(s2), 'final hash equal');
      ok(checked >= 1, 'at least one intermediate checkpoint reached');
      // suggest must not consume the rules random stream
      if (!s1.over) throw new Error('unreachable');
      var fresh = Rules.createGame(cfg);
      var rngBefore = fresh.rng;
      Rules.suggest(fresh);
      eq(fresh.rng, rngBefore, 'suggest does not change state.rng');
    });
  }
});

// ---------- chainOffer ----------
test('chainOffer returns 2 on crafted chain board', function () {
  // 2x2: b00,b10 set up so edge v01 opens a chain of exactly 2 (b00 → b10).
  var s = Rules.createGame(cfg2p());
  s.he[0][0] = 1; s.ve[0][0] = 1;   // b00: 2 drawn (open v01, h10)
  s.he[2][0] = 1; s.ve[1][0] = 1;   // b10: 2 drawn (open h10, v11)
  eq(Rules.chainOffer(s, { dir: 'v', r: 0, c: 1 }), 2, 'chain of 2 offered');
  eq(Rules.chainOffer(s, { dir: 'h', r: 0, c: 1 }), 0, 'safe edge offers nothing');
});

// ---------- AI ----------
test('aiMove always legal; medium/hard take free box; hard minimizes chain', function () {
  var s = Rules.createGame(cfg2p({ rows: 3, cols: 3, seed: 7 }));
  ['easy', 'medium', 'hard'].forEach(function (d) {
    var m = Rules.aiMove(Rules.clone(s), d);
    ok(m, d + ' returns a move');
    eq(Rules.checkDraw(s, m.dir, m.r, m.c), null, d + ' move is legal');
  });
  // Free box available: b00 has 3 sides → medium/hard must take it.
  var fb = Rules.createGame(cfg2p({ rows: 1, cols: 2 }));
  fb.he[0][0] = 1; fb.he[1][0] = 1; fb.ve[0][0] = 1; // b0: 3 sides, open v01
  ['medium', 'hard'].forEach(function (d) {
    var m = Rules.aiMove(Rules.clone(fb), d);
    eq([m.dir, m.r, m.c], ['v', 0, 1], d + ' takes the free box');
  });
  // Forced choice: every legal edge is risky; chains of 1 vs 3 (hole splits the strip).
  var ch = Rules.createGame(cfg2p({ rows: 1, cols: 5, holes: [[0, 1]] }));
  [0, 1, 2, 3, 4].forEach(function (c) { ch.he[0][c] = 1; ch.he[1][c] = 1; }); // tops+bottoms drawn (incl. hole column)
  eq(Rules.chainOffer(ch, { dir: 'v', r: 0, c: 0 }), 1, 'short chain = 1');
  eq(Rules.chainOffer(ch, { dir: 'v', r: 0, c: 5 }), 3, 'long chain = 3');
  var pick = Rules.aiMove(ch, 'hard');
  eq(Rules.chainOffer(ch, pick), 1, 'hard opens the smallest chain');
});

// ---------- fuzz ----------
test('fuzz: 2000 malformed commands never throw, hang, or produce NaN', function () {
  var frng = RNG.create(0xf00d);
  var states = [Rules.createGame(cfg2p()), script1x2()];
  function fuzzCmd() {
    var pool = [
      function () { return { type: 'draw', dir: frng.pick(['h', 'v', 'x', 1, null]), r: frng.range(-5, 50), c: frng.range(-5, 50) }; },
      function () { return { type: 'draw', dir: 'h', r: frng.next(), c: NaN }; },
      function () { return { type: 'draw', dir: 'v', r: 1e12, c: -1e12 }; },
      function () { return { type: 'draw', dir: 'h', r: '0', c: 'a' }; },
      function () { return { type: frng.pick(['nope', '', 'RESIGN', 'drawww']) }; },
      function () { return {}; },
      function () { return null; },
      function () { return 42; },
      function () { return { type: 'resign', player: frng.range(-1, 5) }; },
      function () { return { type: 'timeout' }; },
      function () { return { type: 'draw', dir: 'h', r: frng.int(3), c: frng.int(3), player: frng.pick([0, 1, 2, -1, '0', null, NaN]) }; },
      function () { return { type: 'draw', dir: 'h', r: frng.int(3), c: frng.int(3), extra: { nested: [1, 2, { x: 'y' }] } }; }
    ];
    return frng.pick(pool)();
  }
  for (var i = 0; i < 2000; i++) {
    var idx = frng.int(states.length);
    if (states[idx].over) states[idx] = idx === 0 ? Rules.createGame(cfg2p()) : script1x2();
    var s = states[idx];
    var res;
    try { res = Rules.applyCommand(s, fuzzCmd()); }
    catch (e) { throw new Error('applyCommand threw on fuzz input #' + i + ': ' + e.message); }
    ok(res && typeof res.ok === 'boolean', 'result shape #' + i);
    if (!res.ok) eq(typeof res.reason, 'string', 'failure has reason #' + i);
    s.scores.forEach(function (sc) { ok(Number.isFinite(sc), 'no NaN score #' + i); });
    ok(Number.isFinite(s.boxesLeft) && s.boxesLeft >= 0, 'boxesLeft sane #' + i);
  }
});
