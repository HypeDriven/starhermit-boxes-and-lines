/* Boxes & Lines — local session orchestration: validated commands,
 * replay log, undo checkpoints, hints, elapsed clock, score breakdown.
 * No DOM, no timers — the caller (main.js) drives time and AI turns.
 * Browser global: window.BLSession; Node: require.
 */
(function (root, factory) {
  var Rules = (typeof module === 'object' && module.exports) ? require('./rules.js') : root.BLRules;
  var api = factory(Rules);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLSession = api;
})(typeof self !== 'undefined' ? self : this, function (Rules) {
  'use strict';

  var REPLAY_VERSION = 1;

  function create(cfg, mode) {
    var state = Rules.createGame(cfg);
    return {
      cfg: state.cfg,           // normalized cfg snapshot (replay header)
      mode: mode || state.cfg.kind || 'practice',
      state: state,
      log: [],                  // ordered validated commands (replay body)
      undoStack: [],            // {json, logLen, elapsedMs, invalid}
      invalid: state.players.map(function () { return 0; }),
      hintsUsed: 0,
      assists: false,
      elapsedMs: 0,
      active: true,
      lastCmdId: null           // double-commit guard (action identity)
    };
  }

  function isHumanTurn(s) {
    return !s.state.over && s.state.players[s.state.current].type === 'human';
  }

  // Apply a validated command. Returns the rules result; illegal commands
  // are counted per player and leave state untouched.
  function apply(s, cmd) {
    if (!s.active) return { ok: false, reason: 'session-ended' };
    if (cmd && cmd.id != null && cmd.id === s.lastCmdId)
      return { ok: false, reason: 'duplicate-command' };
    var res = Rules.applyCommand(s.state, cmd);
    if (!res.ok) {
      var who = s.state.current;
      s.invalid[who] = (s.invalid[who] || 0) + 1;
      return res;
    }
    if (cmd.id != null) s.lastCmdId = cmd.id;
    s.log.push({ type: cmd.type, dir: cmd.dir, r: cmd.r, c: cmd.c, player: cmd.player, id: cmd.id });
    if (s.state.over) s.active = false;
    return res;
  }

  // Snapshot before a human move so undo restores the whole turn cascade
  // (the human move plus any AI replies that followed).
  function checkpoint(s) {
    if (!s.cfg.mechanics.undo || !s.active) return;
    s.undoStack.push({
      json: Rules.serialize(s.state),
      logLen: s.log.length,
      elapsedMs: s.elapsedMs,
      invalid: s.invalid.slice()
    });
    if (s.undoStack.length > 200) s.undoStack.shift();
  }

  function canUndo(s) {
    return s.cfg.mechanics.undo && s.undoStack.length > 0;
  }

  function undo(s) {
    if (!canUndo(s)) return false;
    var snap = s.undoStack.pop();
    var st = Rules.deserialize(snap.json);
    if (!st) return false;
    s.state = st;
    s.log.length = snap.logLen;
    s.elapsedMs = snap.elapsedMs;
    s.invalid = snap.invalid;
    s.lastCmdId = null;
    s.active = !st.over;
    return true;
  }

  function hint(s) {
    if (!s.cfg.mechanics.hint || s.state.over) return null;
    var move = Rules.suggest(s.state);
    if (move) { s.hintsUsed++; s.assists = true; }
    return move;
  }

  // One deterministic AI move for the current player (null if human/over).
  function aiStep(s) {
    if (s.state.over) return null;
    var p = s.state.players[s.state.current];
    if (p.type !== 'ai') return null;
    var edge = Rules.aiMove(s.state, p.ai);
    if (!edge) return null;
    var cmd = { type: 'draw', dir: edge.dir, r: edge.r, c: edge.c, player: s.state.current };
    var res = Rules.applyCommand(s.state, cmd);
    if (res.ok) {
      // AI moves are part of the ordered command log so that replaying the
      // envelope reproduces the exact terminal hash (see envelope/replay).
      s.log.push({ type: cmd.type, dir: cmd.dir, r: cmd.r, c: cmd.c, player: cmd.player });
      if (s.state.over) s.active = false;
    }
    return res;
  }

  // Time limit enforcement driven by the caller's clock.
  function tick(s, ms) {
    if (!s.active) return null;
    s.elapsedMs += ms;
    if (s.cfg.timeLimitSec && s.elapsedMs >= s.cfg.timeLimitSec * 1000) {
      return apply(s, { type: 'timeout' });
    }
    return null;
  }

  // Replay envelope: schema, content version, seed, ordered commands,
  // terminal hash. Property: replaying envelope produces finalHash.
  function envelope(s) {
    return {
      v: REPLAY_VERSION,
      contentVersion: s.cfg.version,
      cfg: s.cfg,
      seed: s.cfg.seed,
      commands: s.log.slice(),
      finalHash: Rules.hashState(s.state),
      result: Rules.outcome(s.state)
    };
  }

  // Re-run an envelope; returns the terminal state hash or null on mismatch.
  // Commands logged for AI players are re-derived with Rules.aiMove (which
  // also reproduces the rules random stream) and must match the log exactly.
  function replay(env) {
    if (!env || env.v !== REPLAY_VERSION || !env.cfg) return null;
    var state = Rules.createGame(env.cfg);
    for (var i = 0; i < env.commands.length; i++) {
      var cmd = env.commands[i];
      if (cmd && cmd.type === 'draw' && !state.over) {
        var p = state.players[state.current];
        if (p && p.type === 'ai') {
          var edge = Rules.aiMove(state, p.ai);
          if (!edge || edge.dir !== cmd.dir || edge.r !== cmd.r || edge.c !== cmd.c) return null;
        }
      }
      var res = Rules.applyCommand(state, cmd);
      if (!res.ok) return null;
    }
    return Rules.hashState(state);
  }

  return {
    REPLAY_VERSION: REPLAY_VERSION,
    create: create,
    isHumanTurn: isHumanTurn,
    apply: apply,
    checkpoint: checkpoint,
    canUndo: canUndo,
    undo: undo,
    hint: hint,
    aiStep: aiStep,
    tick: tick,
    envelope: envelope,
    replay: replay
  };
});
