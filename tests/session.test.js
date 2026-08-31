/* Boxes & Lines — session orchestration tests (js/session.js). */
'use strict';
var H = require('./helpers.js');
var Rules = require('../js/rules.js');
var Session = require('../js/session.js');
var test = H.test, eq = H.eq, ok = H.ok;

function mkCfg(extra) {
  return Object.assign({
    id: 'sess-t', version: 1, seed: 11, rows: 2, cols: 2,
    players: [{ name: 'You', type: 'human' }, { name: 'Bot', type: 'ai', ai: 'medium' }],
    mechanics: { undo: true, hint: true }
  }, extra || {});
}
function firstEdge(s) {
  var e = Rules.legalActions(s.state)[0];
  return { type: 'draw', dir: e.dir, r: e.r, c: e.c };
}

test('create/apply/logs', function () {
  var s = Session.create(mkCfg());
  eq(s.log.length, 0); eq(s.elapsedMs, 0); ok(s.active);
  var cmd = firstEdge(s); cmd.id = 'c1';
  var res = Session.apply(s, cmd);
  ok(res.ok, 'apply ok');
  eq(s.log.length, 1);
  eq(s.log[0].id, 'c1');
  eq(s.lastCmdId, 'c1');
});

test('duplicate command id rejected, not double-applied', function () {
  var s = Session.create(mkCfg());
  var cmd = firstEdge(s); cmd.id = 'dup';
  ok(Session.apply(s, cmd).ok);
  var hash = Rules.hashState(s.state), logLen = s.log.length;
  var res = Session.apply(s, cmd);
  eq(res.ok, false);
  eq(res.reason, 'duplicate-command');
  eq(Rules.hashState(s.state), hash, 'state untouched by duplicate');
  eq(s.log.length, logLen, 'log untouched by duplicate');
});

test('invalid command counted in sess.invalid', function () {
  var s = Session.create(mkCfg());
  var cmd = firstEdge(s);
  ok(Session.apply(s, cmd).ok); // human move; AI to move? no — apply passes turn to AI player
  // force human turn again by driving AI
  Session.aiStep(s);
  var who = s.state.current;
  var before = s.invalid[who];
  var legal = Rules.legalActions(s.state)[0];
  Session.apply(s, { type: 'draw', dir: legal.dir, r: legal.r, c: legal.c, player: (who + 1) % 2 }); // wrong player
  eq(s.invalid[who], before + 1, 'invalid counted for current player');
});

test('checkpoint + undo restores state/log/elapsed exactly', function () {
  var s = Session.create(mkCfg());
  Session.tick(s, 100);
  Session.checkpoint(s);
  var hash = Rules.hashState(s.state), logLen = s.log.length, elapsed = s.elapsedMs;
  ok(Session.canUndo(s), 'canUndo after checkpoint');
  var cmd = firstEdge(s); cmd.id = 'u1';
  Session.apply(s, cmd);
  Session.tick(s, 50);
  Session.aiStep(s);
  ok(Rules.hashState(s.state) !== hash || s.log.length !== logLen, 'state changed');
  eq(Session.undo(s), true);
  eq(Rules.hashState(s.state), hash, 'state restored');
  eq(s.log.length, logLen, 'log restored');
  eq(s.elapsedMs, elapsed, 'elapsed restored');
});

test('canUndo respects mechanics.undo=false', function () {
  var s = Session.create(mkCfg({ mechanics: { undo: false, hint: true } }));
  Session.checkpoint(s);
  eq(s.undoStack.length, 0, 'checkpoint skipped when undo disabled');
  eq(Session.canUndo(s), false);
  eq(Session.undo(s), false);
});

test('hint returns legal move, sets assists, increments hintsUsed', function () {
  var s = Session.create(mkCfg());
  var rngBefore = s.state.rng;
  var mv = Session.hint(s);
  ok(mv, 'hint returned');
  eq(Rules.checkDraw(s.state, mv.dir, mv.r, mv.c), null, 'hint is legal');
  eq(s.hintsUsed, 1);
  eq(s.assists, true);
  eq(s.state.rng, rngBefore, 'hint does not consume stream');
  var noHint = Session.create(mkCfg({ mechanics: { undo: true, hint: false } }));
  eq(Session.hint(noHint), null, 'hint disabled → null');
});

test('aiStep only acts for AI players', function () {
  var s = Session.create(mkCfg());
  eq(Session.aiStep(s), null, 'human turn → null');
  var cmd = firstEdge(s); cmd.id = 'a1';
  Session.apply(s, cmd); // passes to AI (no box on first edge of fresh board? edge may complete nothing — fresh board, yes pass)
  if (s.state.current === 1) {
    var res = Session.aiStep(s);
    ok(res && res.ok, 'aiStep applied for AI player');
    ok(s.state.moves[1] >= 1, 'AI move recorded');
  }
  var over = Session.create(mkCfg());
  Rules.applyCommand(over.state, { type: 'resign' });
  eq(Session.aiStep(over), null, 'over → null');
});

test('tick accumulates elapsedMs and fires timeout at limit', function () {
  var s = Session.create(mkCfg({ timeLimitSec: 1 }));
  eq(Session.tick(s, 500), null);
  eq(s.elapsedMs, 500);
  var res = Session.tick(s, 600);
  eq(s.elapsedMs, 1100);
  ok(res && res.ok, 'timeout command applied');
  eq(s.state.over, true);
  eq(s.state.reason, 'time-up');
  eq(s.active, false);
  eq(Session.tick(s, 100), null, 'inactive session ignores tick');
  eq(s.elapsedMs, 1100, 'elapsed frozen');
});

test('envelope → replay reproduces finalHash; tamper rejected', function () {
  var s = Session.create(mkCfg({
    seed: 99,
    players: [{ name: 'P1', type: 'human' }, { name: 'P2', type: 'human' }]
  }));
  for (var i = 0; i < 8 && !s.state.over; i++) {
    var e = Rules.legalActions(s.state)[0];
    var res = Session.apply(s, { type: 'draw', dir: e.dir, r: e.r, c: e.c, id: 'r' + i });
    ok(res.ok, 'replay move ' + i);
  }
  var env = Session.envelope(s);
  eq(env.v, Session.REPLAY_VERSION);
  eq(env.commands.length, s.log.length);
  eq(Session.replay(env), env.finalHash, 'replay matches final hash');
  // tamper: flip one draw's r to 99 (out of bounds → applyCommand fails → null)
  var bad = JSON.parse(JSON.stringify(env));
  var drawCmd = bad.commands.filter(function (c) { return c.type === 'draw'; })[0];
  ok(drawCmd, 'a draw command exists in the log');
  drawCmd.r = 99;
  var out = Session.replay(bad);
  ok(out === null || out !== env.finalHash, 'tampered replay rejected or mismatched');
});

test('envelope replay reproduces games containing AI moves', function () {
  // Regression: aiStep must log its command so replay interleaves AI turns.
  var s = Session.create(mkCfg({ seed: 4242 }));
  for (var i = 0; i < 12 && !s.state.over; i++) {
    if (s.state.players[s.state.current].type === 'ai') {
      ok(Session.aiStep(s).ok, 'aiStep ok at ' + i);
    } else {
      var e = Rules.legalActions(s.state)[0];
      ok(Session.apply(s, { type: 'draw', dir: e.dir, r: e.r, c: e.c, id: 'h' + i }).ok, 'human move ' + i);
    }
  }
  ok(s.log.some(function (c) { return c.player === 1; }), 'AI commands are logged');
  var env = Session.envelope(s);
  eq(Session.replay(env), env.finalHash, 'replay with AI moves matches final hash');
});
