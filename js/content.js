/* Boxes & Lines — versioned content: players, themes, journey stages,
 * challenges, tutorial lessons, practice presets, daily ruleset generator.
 * Shared browser (window.BLContent) / Node. Content is data-only; all
 * randomness enters through the config seed.
 */
(function (root, factory) {
  var RNG = (typeof module === 'object' && module.exports) ? require('./rng.js') : root.BLRNG;
  var api = factory(RNG);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLContent = api;
})(typeof self !== 'undefined' ? self : this, function (RNG) {
  'use strict';

  var CONTENT_VERSION = 1;

  // ---------- players ----------
  // Color is always reinforced by a shape (paper stamp) and a name.
  var PLAYER_STYLES = [
    { name: 'You',    icon: '●', shape: 'circle',   color: 0x3f8efc, colorHC: 0x2e6fe4, css: '#3f8efc' },
    { name: 'Rival',  icon: '▲', shape: 'triangle', color: 0xef5d4e, colorHC: 0xe4572e, css: '#ef5d4e' },
    { name: 'Third',  icon: '■', shape: 'square',   color: 0xe8b23f, colorHC: 0xf5d90a, css: '#e8b23f' },
    { name: 'Fourth', icon: '◆', shape: 'diamond',  color: 0x5fbf77, colorHC: 0x17a398, css: '#5fbf77' }
  ];
  var AI_NAMES = { easy: 'Pip', medium: 'Margot', hard: 'Vega' };
  var AI_LEVELS = ['easy', 'medium', 'hard'];

  function aiPlayer(level, slot) {
    return { name: AI_NAMES[level] + (slot > 1 ? ' ' + slot : ''), type: 'ai', ai: level };
  }

  // ---------- themes (cosmetic only: desk, paper, light, ambience) ----------
  var THEMES = [
    { id: 'graphite', name: 'Graph Paper Desk', unlockStars: 0,
      palette: { desk: 0x6e4a2e, deskDark: 0x503523, paper: 0xf2ead8, grid: 0x9db4c8,
                 dot: 0x4a4038, wall: 0x3a2e26, light: 0xffd9a8, fog: 0x2a211b } },
    { id: 'blueprint', name: 'Blueprint Table', unlockStars: 0,
      palette: { desk: 0x2e3a4a, deskDark: 0x212b38, paper: 0x27435e, grid: 0x7fa8c8,
                 dot: 0xd8e4ee, wall: 0x1c2530, light: 0xbfe0ff, fog: 0x141c26 } },
    { id: 'kraft', name: 'Kraft Workshop', unlockStars: 0,
      palette: { desk: 0x7a5a38, deskDark: 0x5a4028, paper: 0xd8bd8f, grid: 0xa8895e,
                 dot: 0x4a3520, wall: 0x33271c, light: 0xffc98a, fog: 0x241b12 } },
    { id: 'midnight', name: 'Midnight Studio', unlockStars: 15,
      palette: { desk: 0x2a2530, deskDark: 0x1e1a24, paper: 0x322d3e, grid: 0x6a6080,
                 dot: 0xc8c0d8, wall: 0x181420, light: 0xb09fff, fog: 0x100d16 } },
    { id: 'rosewood', name: 'Rosewood Parlour', unlockStars: 40,
      palette: { desk: 0x5a2e2e, deskDark: 0x402020, paper: 0xead8c8, grid: 0xb08a80,
                 dot: 0x3e2828, wall: 0x2c1a1a, light: 0xffb0a0, fog: 0x201212 } }
  ];

  // ---------- journey ----------
  // Compact authored rows:
  // [id, name, seed, rows, cols, aiLevel(0 easy|1 medium|2 hard), nPlayers,
  //  prefillEdges, timeLimitSec, parTimeSec, starMargin, themeIdx, intro]
  var J = [
    ['j01', 'First Lines',     7101, 2, 3, 0, 2, 0,   0, 120, 1, 0, 'Draw one edge between two dots. Close all four sides of a box to claim it — and draw again.'],
    ['j02', 'Open Sheet',      7102, 3, 3, 0, 2, 0,   0, 150, 1, 0, 'Pip likes random lines. Take every free box it hands you.'],
    ['j03', 'Corners',         7103, 3, 3, 0, 2, 2,   0, 150, 1, 0, 'Some lines are already inked. Work around them.'],
    ['j04', 'Wider Desk',      7104, 3, 4, 0, 2, 0,   0, 180, 1, 0, ''],
    ['j05', 'First Mastery',   7105, 3, 4, 1, 2, 0,   0, 180, 2, 0, 'MASTERY: Margot never gives away a free box. Beat her by two.'],
    ['j06', 'Third Pencil',    7106, 3, 3, 0, 3, 0,   0, 180, 1, 0, 'Three pencils now. Watch who follows whom — claimed boxes grant extra turns.'],
    ['j07', 'Steady Hand',     7107, 4, 4, 1, 2, 0,   0, 240, 2, 0, ''],
    ['j08', 'Ink Blots',       7108, 4, 4, 1, 2, 4,   0, 240, 2, 0, ''],
    ['j09', 'Long Rows',       7109, 3, 5, 1, 2, 0,   0, 240, 2, 0, ''],
    ['j10', 'Second Mastery',  7110, 4, 4, 1, 2, 4, 150, 240, 2, 1, 'MASTERY: a clock joins the desk. Finish inside the limit.'],
    ['j11', 'Blue Lines',      7111, 4, 4, 1, 2, 0,   0, 240, 2, 1, ''],
    ['j12', 'Crowded Page',    7112, 4, 5, 1, 2, 0,   0, 300, 2, 1, ''],
    ['j13', 'Three Pencils',   7113, 4, 4, 1, 3, 0,   0, 300, 2, 1, ''],
    ['j14', 'Torn Corner',     7114, 4, 5, 1, 2, 6,   0, 300, 2, 1, ''],
    ['j15', 'Third Mastery',   7115, 4, 5, 2, 2, 0,   0, 300, 3, 1, 'MASTERY: Vega counts chains. Do not open one you cannot close.'],
    ['j16', 'Kraft Stock',     7116, 5, 5, 1, 2, 0,   0, 360, 2, 2, ''],
    ['j17', 'Workshop Rush',   7117, 5, 5, 1, 2, 0, 210, 360, 2, 2, ''],
    ['j18', 'Split Focus',     7118, 4, 6, 1, 2, 6,   0, 360, 3, 2, ''],
    ['j19', 'Full Table',      7119, 5, 5, 1, 4, 0,   0, 360, 2, 2, 'Four pencils. Every pass is someone else\'s chance.'],
    ['j20', 'Fourth Mastery',  7120, 5, 5, 2, 2, 4, 240, 360, 3, 2, 'MASTERY: inked lines, a clock, and Vega. Win by three.'],
    ['j21', 'Tall Sheet',      7121, 5, 4, 2, 2, 0,   0, 360, 3, 2, ''],
    ['j22', 'Margot Returns',  7122, 5, 5, 1, 3, 4,   0, 360, 2, 3, ''],
    ['j23', 'Clockwork',       7123, 5, 5, 2, 2, 0, 200, 360, 3, 3, ''],
    ['j24', 'Six Wide',        7124, 5, 6, 1, 2, 0,   0, 420, 3, 3, ''],
    ['j25', 'Fifth Mastery',   7125, 5, 6, 2, 2, 6,   0, 420, 4, 3, 'MASTERY: the widest sheet yet. Vega is patient — outlast her.'],
    ['j26', 'Midnight Oil',    7126, 5, 5, 2, 2, 0,   0, 360, 3, 3, ''],
    ['j27', 'Four at Midnight',7127, 4, 5, 1, 4, 4,   0, 360, 2, 3, ''],
    ['j28', 'Narrow Margin',   7128, 5, 5, 2, 2, 0,   0, 300, 4, 3, 'Win by four. Every chain matters.'],
    ['j29', 'Grand Sheet',     7129, 6, 6, 1, 2, 0,   0, 480, 3, 3, ''],
    ['j30', 'Sixth Mastery',   7130, 6, 6, 2, 2, 0, 300, 480, 4, 3, 'MASTERY: thirty-six boxes against Vega, on the clock.'],
    ['j31', 'Rosewood',        7131, 5, 6, 2, 2, 6,   0, 420, 4, 4, ''],
    ['j32', 'Parlour Game',    7132, 5, 5, 1, 4, 6,   0, 360, 3, 4, ''],
    ['j33', 'Deep Chains',     7133, 6, 6, 2, 2, 0,   0, 480, 4, 4, ''],
    ['j34', 'Blot & Clock',    7134, 6, 6, 2, 2, 8, 280, 480, 4, 4, ''],
    ['j35', 'Seventh Mastery', 7135, 6, 7, 2, 2, 0,   0, 540, 5, 4, 'MASTERY: the full grand sheet. Vega at her best.'],
    ['j36', 'Long Evening',    7136, 6, 6, 2, 3, 0,   0, 480, 4, 4, ''],
    ['j37', 'No Free Ink',     7137, 6, 6, 2, 2, 10,  0, 480, 4, 4, ''],
    ['j38', 'Final Sprint',    7138, 6, 6, 2, 2, 0, 240, 480, 4, 4, ''],
    ['j39', 'Grand Parlour',   7139, 6, 7, 2, 3, 6,   0, 540, 4, 4, ''],
    ['j40', 'Master of Lines', 7140, 7, 7, 2, 2, 8, 300, 600, 5, 4, 'MASTERY: forty-nine boxes, pre-inked, timed, against Vega. The final sheet.']
  ];

  function expandLevel(row, idx) {
    var players = [{ name: 'You', type: 'human' }];
    for (var i = 1; i < row[6]; i++) players.push(aiPlayer(AI_LEVELS[row[5]], i));
    var mastery = row[12].indexOf('MASTERY') === 0;
    return {
      id: row[0], version: CONTENT_VERSION, kind: 'journey', name: row[1],
      index: idx, seed: row[2], rows: row[3], cols: row[4],
      players: players,
      prefill: row[7], timeLimitSec: row[8],
      par: { timeSec: row[9] },
      starMargin: row[10], mastery: mastery,
      theme: THEMES[row[11]].id,
      intro: row[12],
      goalText: mastery ? 'Win by ' + row[10] + '+ boxes' : 'Claim the most boxes',
      mechanics: { undo: false, hint: true },
      ranked: true
    };
  }
  var JOURNEY = J.map(expandLevel);

  // ---------- challenges (constrained goals; separate bests) ----------
  var CHALLENGES = [
    { id: 'c-blitz', name: 'Sixty-Second Desk', seed: 9101, rows: 3, cols: 3,
      players: [{ name: 'You', type: 'human' }, aiPlayer('medium')],
      timeLimitSec: 60, par: { timeSec: 60 },
      goalText: 'Win a 3×3 sheet in under a minute.',
      mechanics: { undo: false, hint: false }, ranked: true, theme: 'graphite' },
    { id: 'c-long', name: 'The Long Sheet', seed: 9102, rows: 6, cols: 7,
      players: [{ name: 'You', type: 'human' }, aiPlayer('medium')],
      timeLimitSec: 0, par: { timeSec: 600 },
      goalText: 'Forty-two boxes against Margot. Settle in.',
      mechanics: { undo: false, hint: true }, ranked: true, theme: 'kraft' },
    { id: 'c-handicap', name: 'Head Start', seed: 9103, rows: 4, cols: 4,
      players: [{ name: 'You', type: 'human' }, aiPlayer('medium')],
      startPlayer: 1, prefill: 6, par: { timeSec: 300 },
      goalText: 'Margot opens. Six lines are already inked. Win anyway.',
      mechanics: { undo: false, hint: true }, ranked: true, theme: 'blueprint' },
    { id: 'c-party', name: 'Four Pencils', seed: 9104, rows: 5, cols: 5,
      players: [{ name: 'You', type: 'human' }, aiPlayer('easy'), aiPlayer('medium', 2), aiPlayer('hard', 3)],
      par: { timeSec: 420 },
      goalText: 'Three rivals, one sheet. Finish first.',
      mechanics: { undo: false, hint: false }, ranked: true, theme: 'rosewood' },
    { id: 'c-first5', name: 'First to Five', seed: 9105, rows: 5, cols: 5,
      players: [{ name: 'You', type: 'human' }, aiPlayer('hard')],
      goal: { type: 'first-to', target: 5 }, par: { timeSec: 240 },
      goalText: 'Race Vega to five boxes. The sheet never fills.',
      mechanics: { undo: false, hint: false }, ranked: true, theme: 'midnight' },
    { id: 'c-perfect', name: 'Surveyor\'s Exam', seed: 9106, rows: 4, cols: 4,
      players: [{ name: 'You', type: 'human' }, aiPlayer('hard')],
      par: { timeSec: 300 },
      goalText: 'Beat Vega at her own game. No hints.',
      mechanics: { undo: false, hint: false }, ranked: true, theme: 'midnight' }
  ].map(function (c) {
    c.version = CONTENT_VERSION; c.kind = 'challenge';
    return c;
  });

  // ---------- practice presets (unranked, undo allowed) ----------
  var PRACTICE = [
    { id: 'p-sketch', name: 'Sketch', seed: 0, rows: 3, cols: 3,
      par: { timeSec: 180 }, mechanics: { undo: true, hint: true }, theme: 'graphite' },
    { id: 'p-study', name: 'Study', seed: 0, rows: 4, cols: 4,
      par: { timeSec: 300 }, mechanics: { undo: true, hint: true }, theme: 'kraft' },
    { id: 'p-master', name: 'Master Sheet', seed: 0, rows: 6, cols: 6,
      par: { timeSec: 600 }, mechanics: { undo: true, hint: true }, theme: 'blueprint' }
  ].map(function (p) { p.version = CONTENT_VERSION; p.kind = 'practice'; return p; });

  // Practice configs are built on demand (selectable difficulty, fresh seed).
  function practiceConfig(presetId, aiLevel, seed) {
    var base = PRACTICE.filter(function (p) { return p.id === presetId; })[0] || PRACTICE[0];
    var cfg = Object.assign({}, base, {
      seed: (seed == null ? 1 : seed) >>> 0,
      players: [{ name: 'You', type: 'human' }, aiPlayer(aiLevel || 'medium')],
      ranked: false
    });
    return cfg;
  }

  // ---------- daily (immutable per UTC date) ----------
  var DAILY_BOARDS = [[3, 3], [4, 4], [4, 5], [5, 5], [5, 6]];
  function dailyConfig(dateStr) {
    var seed = RNG.hashString('boxes-and-lines:daily:' + dateStr);
    var rng = RNG.derive(seed, RNG.STREAM_DECOR);
    var board = DAILY_BOARDS[rng.int(DAILY_BOARDS.length)];
    var ai = AI_LEVELS[rng.int(AI_LEVELS.length)];
    var timed = rng.next() < 0.35;
    var prefill = rng.next() < 0.4 ? rng.range(2, 6) : 0;
    return {
      id: 'daily-' + dateStr, version: CONTENT_VERSION, kind: 'daily',
      name: 'Daily Sheet — ' + dateStr,
      seed: seed, rows: board[0], cols: board[1],
      players: [{ name: 'You', type: 'human' }, aiPlayer(ai)],
      prefill: prefill,
      timeLimitSec: timed ? Math.max(90, board[0] * board[1] * 12) : 0,
      par: { timeSec: board[0] * board[1] * 14 },
      theme: THEMES[rng.int(3)].id, // daily sticks to the always-unlocked themes
      mechanics: { undo: false, hint: true },
      ranked: true, date: dateStr,
      goalText: 'One shared sheet for everyone today. Most boxes wins.'
    };
  }

  function utcDateString(nowMs) {
    var d = new Date(nowMs == null ? Date.now() : nowMs);
    return d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0');
  }

  // ---------- lessons (Learn mode: one rule at a time, performed) ----------
  // goal.event matches rules events: 'draw' (any), 'draw-safe' (no box offered),
  // 'box' (a claim), 'extra-turn', 'over'.
  function tutorialLessons() {
    return [
      { id: 'L1', title: 'Draw a line', theme: 'graphite',
        text: 'Tap (or arrow-key to) any faint edge between two dots, then confirm. Draw two lines to finish.',
        cfg: { id: 'lesson-1', version: CONTENT_VERSION, kind: 'learn', name: 'Lesson 1',
               seed: 501, rows: 2, cols: 2,
               players: [{ name: 'You', type: 'human' }],
               mechanics: { undo: true, hint: true } },
        goal: { event: 'draw', count: 2 } },
      { id: 'L2', title: 'Claim a box', theme: 'graphite',
        text: 'Three sides of the middle box are drawn. Close the fourth side to claim it.',
        cfg: { id: 'lesson-2', version: CONTENT_VERSION, kind: 'learn', name: 'Lesson 2',
               seed: 502, rows: 1, cols: 1, prefill: 0,
               players: [{ name: 'You', type: 'human' }],
               mechanics: { undo: true, hint: true } },
        prefillEdges: [{ dir: 'h', r: 0, c: 0 }, { dir: 'h', r: 1, c: 0 }, { dir: 'v', r: 0, c: 0 }],
        goal: { event: 'box', count: 1 } },
      { id: 'L3', title: 'The extra turn', theme: 'graphite',
        text: 'Claiming a box keeps the pencil in your hand. Claim both boxes in one turn.',
        cfg: { id: 'lesson-3', version: CONTENT_VERSION, kind: 'learn', name: 'Lesson 3',
               seed: 503, rows: 1, cols: 2,
               players: [{ name: 'You', type: 'human' }],
               mechanics: { undo: true, hint: true } },
        prefillEdges: [{ dir: 'h', r: 0, c: 0 }, { dir: 'h', r: 1, c: 0 }, { dir: 'v', r: 0, c: 0 },
                       { dir: 'h', r: 0, c: 1 }, { dir: 'h', r: 1, c: 1 }, { dir: 'v', r: 0, c: 2 }],
        goal: { event: 'box', count: 2 } },
      { id: 'L4', title: 'Stay safe', theme: 'kraft',
        text: 'A line that gives a box its third side hands it away. Draw three safe lines — the lamp marks risky edges when you hover them.',
        cfg: { id: 'lesson-4', version: CONTENT_VERSION, kind: 'learn', name: 'Lesson 4',
               seed: 504, rows: 2, cols: 3,
               players: [{ name: 'You', type: 'human' }],
               mechanics: { undo: true, hint: true } },
        goal: { event: 'draw-safe', count: 3 } },
      { id: 'L5', title: 'A real match', theme: 'blueprint',
        text: 'Play a full sheet against Pip. Claim more boxes than your rival to win.',
        cfg: { id: 'lesson-5', version: CONTENT_VERSION, kind: 'learn', name: 'Lesson 5',
               seed: 505, rows: 3, cols: 3,
               players: [{ name: 'You', type: 'human' }, aiPlayer('easy')],
               mechanics: { undo: true, hint: true } },
        goal: { event: 'over', count: 1 } }
    ];
  }

  // Lesson fixtures draw exact edges after createGame (authored setups).
  function applyLessonFixture(state, lesson, Rules) {
    (lesson.prefillEdges || []).forEach(function (e) {
      if (e.dir === 'h') state.he[e.r][e.c] = -1; else state.ve[e.r][e.c] = -1;
    });
  }

  return {
    CONTENT_VERSION: CONTENT_VERSION,
    PLAYER_STYLES: PLAYER_STYLES,
    AI_NAMES: AI_NAMES,
    AI_LEVELS: AI_LEVELS,
    THEMES: THEMES,
    JOURNEY: JOURNEY,
    CHALLENGES: CHALLENGES,
    PRACTICE: PRACTICE,
    practiceConfig: practiceConfig,
    dailyConfig: dailyConfig,
    utcDateString: utcDateString,
    tutorialLessons: tutorialLessons,
    applyLessonFixture: applyLessonFixture
  };
});
