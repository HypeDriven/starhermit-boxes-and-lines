#!/usr/bin/env node
/* Boxes & Lines — offline content validator.
 * Proves basic legality, reachable goals, bounded duration, and absence of
 * soft locks for all versioned content. Importable (module.exports.validate)
 * and standalone: `node tools/validate-content.js` (non-zero exit on failure).
 */
'use strict';
var path = require('path');
var Rules = require(path.join(__dirname, '..', 'js', 'rules.js'));
var Content = require(path.join(__dirname, '..', 'js', 'content.js'));
var Store = require(path.join(__dirname, '..', 'js', 'store.js'));

var MAX_COMMANDS = 10000;
var GOAL_EVENTS = ['draw', 'draw-safe', 'box', 'extra-turn', 'over'];

function edgeCount(rows, cols) { return (rows + 1) * cols + rows * (cols + 1); }

function validate() {
  var errors = [], notes = [];
  function err(msg) { errors.push(msg); }
  function note(msg) { notes.push(msg); }

  // ---------- collect configs ----------
  var lessons = Content.tutorialLessons();
  var practiceCfgs = Content.PRACTICE.map(function (p) { return Content.practiceConfig(p.id, 'medium', 1234); });
  var dailyCfgs = [];
  for (var d = 0; d < 30; d++) dailyCfgs.push(Content.dailyConfig(Content.utcDateString(d * 86400000)));
  var groups = [
    { name: 'journey', cfgs: Content.JOURNEY },
    { name: 'challenges', cfgs: Content.CHALLENGES },
    { name: 'practice', cfgs: practiceCfgs },
    { name: 'lessons', cfgs: lessons.map(function (l) { return l.cfg; }) },
    { name: 'daily', cfgs: dailyCfgs }
  ];

  if (Content.JOURNEY.length < 40) err('journey: expected >= 40 levels, got ' + Content.JOURNEY.length);
  else note('journey: ' + Content.JOURNEY.length + ' levels');

  // ---------- per-config checks ----------
  var seenIds = {};
  groups.forEach(function (g) {
    g.cfgs.forEach(function (cfg) {
      var tag = g.name + ':' + (cfg && cfg.id);
      if (!cfg || typeof cfg !== 'object') return err(tag + ': not an object');
      if (seenIds[cfg.id]) err(tag + ': duplicate id (also ' + seenIds[cfg.id] + ')');
      seenIds[cfg.id] = tag;
      if (cfg.version !== Content.CONTENT_VERSION) err(tag + ': version ' + cfg.version + ' !== CONTENT_VERSION ' + Content.CONTENT_VERSION);
      if (!(cfg.rows >= 1 && cfg.rows <= 8 && cfg.cols >= 1 && cfg.cols <= 8)) err(tag + ': rows/cols out of range (' + cfg.rows + 'x' + cfg.cols + ')');
      if (!Array.isArray(cfg.players) || cfg.players.length < 1 || cfg.players.length > 4) err(tag + ': players count ' + (cfg.players || []).length);
      else {
        var humans = cfg.players.filter(function (p) { return p.type !== 'ai'; }).length;
        if (humans !== 1) err(tag + ': solo content must have exactly one human, got ' + humans);
        cfg.players.forEach(function (p) {
          if (p.type === 'ai' && Content.AI_LEVELS.indexOf(p.ai) < 0) err(tag + ': invalid AI level ' + p.ai);
        });
      }
      if (cfg.par && !(cfg.par.timeSec > 0)) err(tag + ': par.timeSec must be positive when present');

      var state;
      try { state = Rules.createGame(cfg); } catch (e) { return err(tag + ': createGame threw: ' + e.message); }
      if (!(state.boxesLeft > 0)) err(tag + ': boxesLeft ' + state.boxesLeft);

      // ---------- reachability / no soft lock / bounded duration ----------
      var initialBoxes = state.boxesLeft;
      var isGoalCfg = cfg.goal && cfg.goal.type === 'first-to';
      var cmds = 0;
      while (!state.over && cmds < MAX_COMMANDS) {
        var edge = Rules.aiMove(state, 'medium'); // medium AI drives ALL players
        if (!edge) break;
        var res = Rules.applyCommand(state, { type: 'draw', dir: edge.dir, r: edge.r, c: edge.c });
        if (!res.ok) { err(tag + ': legal API move rejected: ' + res.reason); break; }
        cmds++;
      }
      if (!state.over) return err(tag + ': SOFT LOCK / unbounded — not terminal after ' + cmds + ' commands');
      if (!state.reason) err(tag + ': terminal without reason');
      var scoreSum = state.scores.reduce(function (a, b) { return a + b; }, 0);
      if (scoreSum !== initialBoxes - state.boxesLeft) err(tag + ': score sum ' + scoreSum + ' !== boxes claimed ' + (initialBoxes - state.boxesLeft));
      if (!isGoalCfg) {
        if (state.reason !== 'board-full') err(tag + ': expected board-full, got ' + state.reason);
        if (scoreSum !== initialBoxes) err(tag + ': score sum ' + scoreSum + ' !== initial boxesLeft ' + initialBoxes);
      }
      var moves = state.moves.reduce(function (a, b) { return a + b; }, 0);
      if (moves > edgeCount(state.rows, state.cols)) err(tag + ': moves ' + moves + ' exceed edge count');
    });
  });
  note('configs simulated to completion: ' + Object.keys(seenIds).length);

  // ---------- lessons: fixtures keep goals reachable ----------
  lessons.forEach(function (lesson) {
    var tag = 'lesson:' + lesson.id;
    if (GOAL_EVENTS.indexOf(lesson.goal.event) < 0) err(tag + ': goal.event ' + lesson.goal.event + ' not in ' + GOAL_EVENTS.join('/'));
    var st = Rules.createGame(lesson.cfg);
    Content.applyLessonFixture(st, lesson, Rules);
    if (lesson.goal.event === 'box') {
      var claimable = Rules.legalActions(st).some(function (e) {
        return Rules.previewDraw(st, e.dir, e.r, e.c).claims.length > 0;
      });
      if (!claimable) err(tag + ': no legal draw completes a box after fixture (goal unreachable)');
    }
    if (lesson.goal.event === 'draw-safe') {
      var safe = Rules.legalActions(st).some(function (e) {
        var pv = Rules.previewDraw(st, e.dir, e.r, e.c);
        return !pv.gives && !pv.claims.length;
      });
      if (!safe) err(tag + ': no safe draw available (goal unreachable)');
    }
  });
  note('lessons checked: ' + lessons.length);

  // ---------- daily determinism ----------
  var d0 = Content.dailyConfig('2026-08-30'), d1 = Content.dailyConfig('2026-08-30');
  if (JSON.stringify(d0) !== JSON.stringify(d1)) err('daily: dailyConfig not immutable/deterministic for same date');
  var seeds = {};
  dailyCfgs.forEach(function (cfg) {
    if (seeds[cfg.seed]) err('daily: duplicate seed for ' + cfg.id + ' and ' + seeds[cfg.seed]);
    seeds[cfg.seed] = cfg.id;
    var inBoards = Content.JOURNEY && [[3,3],[4,4],[4,5],[5,5],[5,6]].some(function (b) { return b[0] === cfg.rows && b[1] === cfg.cols; });
    if (!inBoards) err('daily ' + cfg.date + ': board ' + cfg.rows + 'x' + cfg.cols + ' outside DAILY_BOARDS');
    var zeroStar = Content.THEMES.filter(function (t) { return t.unlockStars === 0; }).map(function (t) { return t.id; });
    if (zeroStar.indexOf(cfg.theme) < 0) err('daily ' + cfg.date + ': theme ' + cfg.theme + ' not a zero-star theme');
    if (!(cfg.timeLimitSec === 0 || cfg.timeLimitSec >= 90)) err('daily ' + cfg.date + ': timeLimitSec ' + cfg.timeLimitSec);
  });
  if (Content.utcDateString(0) !== '1970-01-01') err('utcDateString(0) !== 1970-01-01, got ' + Content.utcDateString(0));
  note('daily: 30 consecutive UTC dates checked');

  // ---------- practice fallback ----------
  var fb = Content.practiceConfig('no-such-preset', 'easy', 5);
  if (fb.id !== Content.PRACTICE[0].id) err('practice: unknown preset did not fall back to ' + Content.PRACTICE[0].id);
  if (fb.ranked !== false) err('practice: ranked must be false');
  if (!fb.mechanics.undo) err('practice: undo must be allowed');

  // ---------- themes ----------
  if (Content.THEMES.length !== 5) err('themes: expected 5, got ' + Content.THEMES.length);
  var tids = {};
  Content.THEMES.forEach(function (t) {
    if (tids[t.id]) err('themes: duplicate id ' + t.id);
    tids[t.id] = true;
    ['desk', 'deskDark', 'paper', 'grid', 'dot', 'wall', 'light', 'fog'].forEach(function (k) {
      if (typeof t.palette[k] !== 'number') err('theme ' + t.id + ': missing palette key ' + k);
    });
    if (!(t.unlockStars >= 0)) err('theme ' + t.id + ': unlockStars ' + t.unlockStars);
  });

  // ---------- achievements ----------
  var keys = {};
  if (Store.ACHIEVEMENTS.length < 5) err('achievements: expected >= 5, got ' + Store.ACHIEVEMENTS.length);
  Store.ACHIEVEMENTS.forEach(function (a) {
    if (!/^[a-z0-9-]+$/.test(a.key)) err('achievement key not lowercase-stable: ' + a.key);
    if (keys[a.key]) err('achievement duplicate key: ' + a.key);
    keys[a.key] = true;
  });
  ['first-box', 'first-win', 'chain-3', 'journey-10', 'daily-3', 'boxes-500'].forEach(function (k) {
    if (!keys[k]) err('achievements: missing spec key ' + k);
  });

  return { errors: errors, notes: notes };
}

if (require.main === module) {
  var r = validate();
  r.notes.forEach(function (n) { console.log('  ok  ' + n); });
  if (r.errors.length) {
    r.errors.forEach(function (e) { console.log('FAIL  ' + e); });
    console.log('CONTENT VALIDATION FAILED: ' + r.errors.length + ' error(s)');
    process.exit(1);
  }
  console.log('CONTENT VALIDATION PASSED');
}

module.exports = { validate: validate };
