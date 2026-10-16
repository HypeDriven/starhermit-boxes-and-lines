/* Boxes & Lines — DOM builders for screens and overlays (semantic HTML
 * over/beside the canvas; the 3D scene is never the only UI).
 * Browser global: window.BLUI.
 */
(function (root) {
  'use strict';

  // Localized text (js/i18n.js); English source strings are the keys.
  function T(key, vars) { return root.BLT ? root.BLT(key, vars) : key; }
  // Content (stage, lesson, challenge, preset, theme names) is authored in English.
  function playerName(p) { return p && p.type === 'human' ? T('You') : (p ? p.name : ''); }
  function levelName(lv) { return lv.kind === 'daily' ? T('Daily Sheet — {date}', { date: lv.date }) : T(lv.name); }
  function goalText(lv) {
    if (lv.kind === 'journey' && lv.mastery) return T('Win by {n}+ boxes', { n: lv.starMargin });
    return T(lv.goalText || 'Claim the most boxes');
  }
  var LEVEL_NAMES = { easy: 'easy', medium: 'medium', hard: 'hard' };

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function fmtTime(ms) {
    if (ms == null || ms < 0) return '';
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  function starsText(n) {
    return '★'.repeat(n) + '☆'.repeat(3 - n);
  }

  function modeCard(ctx, opts) {
    var card = el('button', { class: 'card' + (opts.primary ? ' primary-card' : ''), 'aria-label': opts.aria || opts.title });
    card.appendChild(el('span', { class: 'card-title', text: opts.title }));
    if (opts.sub) card.appendChild(el('span', { class: 'card-sub', text: opts.sub }));
    card.addEventListener('click', opts.onClick);
    return card;
  }

  // ---------- title ----------
  function buildTitle(host, ctx) {
    host.innerHTML = '';
    var Content = ctx.Content, Store = ctx.Store;
    var p = ctx.saveDoc.progress;
    var nextStage = Content.JOURNEY.filter(function (lv) {
      return (p.journeyStars[lv.id] || 0) === 0;
    })[0];
    var grid = el('div', { class: 'card-grid' });
    if (nextStage) {
      grid.appendChild(modeCard(ctx, {
        title: '▶ ' + T('Play'), primary: true,
        sub: T('Journey {n} — {name}', { n: nextStage.index + 1, name: T(nextStage.name) }),
        aria: T('Play next journey stage: {name}', { name: T(nextStage.name) }),
        onClick: function () { ctx.onPlay(nextStage); }
      }));
    } else {
      grid.appendChild(modeCard(ctx, {
        title: '▶ ' + T('Play'), primary: true, sub: T('Practice a fresh sheet'),
        onClick: function () { ctx.onMode('practice'); }
      }));
    }
    var dateStr = Content.utcDateString(ctx.serverNow());
    var done = p.dailiesDone[dateStr];
    grid.appendChild(modeCard(ctx, {
      title: T('Daily Sheet'),
      sub: done != null ? T('Done today — score {n}', { n: done }) : T('New shared sheet · {countdown}', { countdown: ctx.dailyCountdown() }),
      onClick: function () { ctx.onDaily(); }
    }));
    grid.appendChild(modeCard(ctx, { title: T('Journey'), sub: T('{n} ★ earned', { n: ctx.totalStars() }), onClick: function () { ctx.onMode('journey'); } }));
    grid.appendChild(modeCard(ctx, { title: T('Practice'), sub: T('Unranked, undo allowed'), onClick: function () { ctx.onMode('practice'); } }));
    grid.appendChild(modeCard(ctx, { title: T('Challenge'), sub: T('Constrained goals'), onClick: function () { ctx.onMode('challenge'); } }));
    grid.appendChild(modeCard(ctx, { title: T('Learn'), sub: T('Five short lessons'), onClick: function () { ctx.onMode('learn'); } }));
    host.appendChild(grid);
    var row = el('div', { class: 'title-links' });
    [['Scores', 'scores'], ['Settings', 'settings'], ['Help', 'help'], ['Profile', 'profile']].forEach(function (l) {
      var b = el('button', { class: 'btn ghost', 'data-screen': l[1], text: T(l[0]) });
      b.addEventListener('click', function () { ctx.onMode(l[1]); });
      row.appendChild(b);
    });
    host.appendChild(row);
    // StarHermit account: status line, sign-in (platform host, no token), invite (signed in)
    if (ctx.account) {
      var acc = ctx.account();
      if (acc.canSignIn || acc.signedIn) {
        var row2 = el('div', { class: 'title-links' });
        if (acc.signedIn) {
          var inv = el('button', { class: 'btn ghost', id: 'btn-invite', text: acc.strings.invite });
          inv.addEventListener('click', function () { ctx.onInvite(); });
          row2.appendChild(inv);
        }
        if (acc.canSignIn) {
          var si = el('button', { class: 'btn ghost', id: 'btn-sign-in', text: acc.strings.signIn });
          si.addEventListener('click', function () { ctx.onSignIn(); });
          row2.appendChild(si);
        }
        host.appendChild(row2);
      }
      host.appendChild(el('p', { class: 'dim account-line', id: 'account-line', text: acc.line }));
    }
  }

  // ---------- practice setup ----------
  function buildPractice(host, ctx) {
    host.innerHTML = '';
    var Content = ctx.Content;
    var preset = Content.PRACTICE[0], ai = 'medium';
    var form = el('div', { class: 'setup-form' });
    form.appendChild(el('h3', { text: T('Sheet size') }));
    var presetRow = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': T('Sheet size') });
    Content.PRACTICE.forEach(function (p, i) {
      var b = el('button', { class: 'seg-btn' + (i === 0 ? ' on' : ''), role: 'radio', 'aria-checked': i === 0 ? 'true' : 'false',
        text: T(p.name) + ' · ' + p.rows + '×' + p.cols });
      b.addEventListener('click', function () {
        preset = p;
        presetRow.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
        b.classList.add('on'); b.setAttribute('aria-checked', 'true');
      });
      presetRow.appendChild(b);
    });
    form.appendChild(presetRow);
    form.appendChild(el('h3', { text: T('Rival') }));
    var aiRow = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': T('Rival difficulty') });
    Content.AI_LEVELS.forEach(function (lv, i) {
      var b = el('button', { class: 'seg-btn' + (i === 1 ? ' on' : ''), role: 'radio', 'aria-checked': i === 1 ? 'true' : 'false',
        text: Content.AI_NAMES[lv] + ' · ' + T(LEVEL_NAMES[lv] || lv) });
      b.addEventListener('click', function () {
        ai = lv;
        aiRow.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
        b.classList.add('on'); b.setAttribute('aria-checked', 'true');
      });
      aiRow.appendChild(b);
    });
    form.appendChild(aiRow);
    form.appendChild(el('p', { class: 'dim', text: T('Practice is unranked: undo is allowed, ratings are untouched. Expect 2–8 minutes.') }));
    var start = el('button', { class: 'btn primary big', text: T('Start sheet') });
    start.addEventListener('click', function () {
      var cfg = Content.practiceConfig(preset.id, ai, (Math.random() * 0xffffffff) >>> 0);
      ctx.onPlay(cfg);
    });
    form.appendChild(start);
    host.appendChild(form);
  }

  // ---------- journey ----------
  function buildJourney(host, ctx) {
    host.innerHTML = '';
    var Content = ctx.Content, p = ctx.saveDoc.progress;
    var unlocked = true; // first stage always open; a stage opens when the previous has a star
    var list = el('div', { class: 'level-list' });
    Content.JOURNEY.forEach(function (lv) {
      var stars = p.journeyStars[lv.id] || 0;
      var open = unlocked;
      unlocked = stars > 0;
      var btn = el('button', {
        class: 'level-row' + (open ? '' : ' locked') + (lv.mastery ? ' mastery' : ''),
        'aria-label': T('Stage {n}: {name}', { n: lv.index + 1, name: T(lv.name) }) + (open ? T(', {n} stars', { n: stars }) : T(', locked')),
        'aria-disabled': open ? 'false' : 'true'
      });
      btn.appendChild(el('span', { class: 'level-num', text: String(lv.index + 1).padStart(2, '0') }));
      btn.appendChild(el('span', { class: 'level-name', text: T(lv.name) }));
      btn.appendChild(el('span', { class: 'level-meta', text: lv.rows + '×' + lv.cols + (lv.timeLimitSec ? ' · ⏱' : '') }));
      btn.appendChild(el('span', { class: 'level-stars', text: open ? starsText(stars) : '🔒' }));
      if (open) btn.addEventListener('click', function () { ctx.onPlay(lv); });
      else btn.disabled = true;
      list.appendChild(btn);
    });
    host.appendChild(list);
  }

  // ---------- challenges ----------
  function buildChallenges(host, ctx) {
    host.innerHTML = '';
    var p = ctx.saveDoc.progress;
    var list = el('div', { class: 'level-list' });
    ctx.Content.CHALLENGES.forEach(function (c) {
      var best = p.challengeBest[c.id];
      var btn = el('button', { class: 'level-row', 'aria-label': T(c.name) + '. ' + T(c.goalText) });
      btn.appendChild(el('span', { class: 'level-name', text: T(c.name) }));
      btn.appendChild(el('span', { class: 'level-meta', text: c.rows + '×' + c.cols + (c.timeLimitSec ? ' · ⏱' : '') }));
      btn.appendChild(el('span', { class: 'level-stars', text: best != null ? String(best) : '—' }));
      btn.appendChild(el('p', { class: 'level-goal', text: T(c.goalText) }));
      btn.addEventListener('click', function () { ctx.onPlay(c); });
      list.appendChild(btn);
    });
    host.appendChild(list);
  }

  // ---------- lessons ----------
  function buildLessonList(host, ctx) {
    host.innerHTML = '';
    var done = ctx.saveDoc.progress.tutorialDone;
    var list = el('div', { class: 'level-list' });
    ctx.Content.tutorialLessons().forEach(function (L, i) {
      var btn = el('button', { class: 'level-row', 'aria-label': T('Lesson {n}: {name}', { n: i + 1, name: T(L.title) }) + (done[L.id] ? T(', complete') : '') });
      btn.appendChild(el('span', { class: 'level-num', text: String(i + 1) }));
      btn.appendChild(el('span', { class: 'level-name', text: T(L.title) }));
      btn.appendChild(el('span', { class: 'level-stars', text: done[L.id] ? '✓' : '' }));
      btn.addEventListener('click', function () { ctx.onLesson(i); });
      list.appendChild(btn);
    });
    host.appendChild(list);
  }

  // ---------- results ----------
  function buildResults(host, ctx, r) {
    // r: {headline, sub, won, breakdown, stars, margin, cfg, canNext, entry}
    // headline is an English key; sub may be a function so it re-renders in the current language.
    host.innerHTML = '';
    host.appendChild(el('h2', { class: r.won ? 'result-win' : 'result-lose', text: T(r.headline) }));
    var sub = typeof r.sub === 'function' ? r.sub() : r.sub;
    if (sub) host.appendChild(el('p', { class: 'dim', text: sub }));
    if (r.stars != null) {
      host.appendChild(el('div', { class: 'result-stars', 'aria-label': T('{n} of 3 stars', { n: r.stars }), text: starsText(r.stars) }));
    }
    var table = el('table', { class: 'breakdown' });
    table.appendChild(el('caption', { text: T('Score breakdown') }));
    r.breakdown.components.forEach(function (c) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: T(c.label) }));
      tr.appendChild(el('td', { class: 'num', text: String(c.points) }));
      table.appendChild(tr);
    });
    var total = el('tr', { class: 'total' });
    total.appendChild(el('td', { text: T('Total') }));
    total.appendChild(el('td', { class: 'num', text: String(r.breakdown.total) }));
    table.appendChild(total);
    host.appendChild(table);
    if (r.newAchievements && r.newAchievements.length) {
      var ul = el('ul', { class: 'ach-list', 'aria-label': T('Achievements unlocked') });
      r.newAchievements.forEach(function (a) {
        ul.appendChild(el('li', { text: '🏅 ' + T(a.name) + ' — ' + T(a.desc) }));
      });
      host.appendChild(ul);
    }
    var lb = typeof r.lb === 'function' ? r.lb() : r.lb;
    if (lb) host.appendChild(el('p', { id: 'results-lb', class: 'dim', 'aria-live': 'polite', text: lb }));
    var row = el('div', { class: 'btn-row' });
    var retry = el('button', { class: 'btn primary', text: '↻ ' + T('Retry') });
    retry.addEventListener('click', ctx.onRetry);
    row.appendChild(retry);
    if (r.canNext) {
      var next = el('button', { class: 'btn', text: T('Next') + ' →' });
      next.addEventListener('click', ctx.onNext);
      row.appendChild(next);
    }
    var home = el('button', { class: 'btn ghost', 'data-action': 'title', text: T('Title') });
    home.addEventListener('click', ctx.onTitle);
    row.appendChild(home);
    host.appendChild(row);
  }

  // ---------- settings ----------
  function buildSettingsForm(host, ctx) {
    host.innerHTML = '';
    var s = ctx.saveDoc.settings;
    var Content = ctx.Content, Store = ctx.Store;

    function slider(label, key) {
      label = T(label);
      var wrap = el('label', { class: 'setting-row' });
      wrap.appendChild(el('span', { text: label }));
      var input = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(s[key]), 'aria-label': label });
      input.addEventListener('input', function () { s[key] = parseFloat(input.value); ctx.onSettings(); });
      wrap.appendChild(input);
      return wrap;
    }
    function toggle(label, key) {
      var wrap = el('label', { class: 'setting-row' });
      wrap.appendChild(el('span', { text: T(label) }));
      var input = el('input', { type: 'checkbox', 'aria-label': T(label), 'data-setting': key });
      input.checked = !!s[key];
      input.addEventListener('change', function () { s[key] = input.checked; ctx.onSettings(); });
      wrap.appendChild(input);
      return wrap;
    }
    function choice(label, key, options) {
      label = T(label);
      var wrap = el('label', { class: 'setting-row' });
      wrap.appendChild(el('span', { text: label }));
      var sel = el('select', { 'aria-label': label });
      options.forEach(function (o) {
        var opt = el('option', { value: o[0], text: o[1] });
        if (s[key] === o[0]) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function () { s[key] = sel.value; ctx.onSettings(); });
      wrap.appendChild(sel);
      return wrap;
    }

    var totalStars = ctx.totalStars();
    host.appendChild(el('h3', { text: T('Audio') }));
    host.appendChild(slider('Music', 'music'));
    host.appendChild(slider('Effects', 'effects'));
    host.appendChild(slider('Ambience', 'ambience'));
    host.appendChild(toggle('Mute all', 'muted'));
    host.appendChild(toggle('Captions for sound cues', 'captions'));
    host.appendChild(el('h3', { text: T('Graphics') }));
    if (ctx.buildGraphics) ctx.buildGraphics(host);
    host.appendChild(choice('Desk theme', 'theme', Content.THEMES.map(function (t) {
      var locked = totalStars < t.unlockStars;
      return [t.id, T(t.name) + (locked ? ' (🔒 ' + t.unlockStars + '★)' : '')];
    })));
    host.appendChild(toggle('Reduced motion', 'reducedMotion'));
    host.appendChild(toggle('High contrast', 'highContrast'));
    host.appendChild(choice('Player colors', 'colorPalette', [['standard', T('Standard')], ['high-visibility', T('High visibility')]]));
    host.appendChild(el('h3', { text: T('Controls & access') }));
    host.appendChild(toggle('Larger text', 'largeText'));
    host.appendChild(toggle('Left-handed layout', 'leftHanded'));
    host.appendChild(toggle('Confirm moves (tap edge twice)', 'confirmMoves'));
    host.appendChild(toggle('Always show button board', 'boardMirror'));
    host.appendChild(toggle('Haptics', 'haptics'));
    var replay = el('button', { class: 'btn ghost', text: T('Replay lessons') });
    replay.addEventListener('click', function () { ctx.onMode('learn'); });
    host.appendChild(replay);
  }

  // ---------- help ----------
  function buildHelp(host, ctx) {
    host.innerHTML = '';
    var cards = [
      ['Draw a line', T('Tap a faint edge between two dots (or move the focus ring with arrow keys and press Enter). One line per turn.')],
      ['Claim a box', T('When your line closes the fourth side of a box, the box folds into your color and stamp — and you draw again.')],
      ['Extra turns chain', T('Claimed boxes grant another line immediately. Long chains swing a match; so can giving one away.')],
      ['The third side is a gift', T('A line that gives a box its third side usually hands it to your rival. The risk lamp warns you before you commit.')],
      ['Winning', T('When the sheet is full, most boxes wins. Ties break on fewer invalid moves, then faster time.')],
      ['Controls', T('Pointer/touch: tap an edge. Keyboard: {keys}. Gamepad: stick/d-pad moves focus, A draws, B cancels, Start pauses.', { keys: ctx && ctx.keysText ? ctx.keysText() : T('arrows move the focus, Enter draws, U undo (practice), H hint, P pause, S skip animation, C reset camera') })]
    ];
    var grid = el('div', { class: 'help-grid' });
    cards.forEach(function (c) {
      var card = el('div', { class: 'help-card' });
      card.appendChild(el('h3', { text: T(c[0]) }));
      card.appendChild(el('p', { text: c[1] }));
      grid.appendChild(card);
    });
    host.appendChild(grid);
  }

  // ---------- profile ----------
  function buildProfile(host, ctx) {
    host.innerHTML = '';
    var p = ctx.saveDoc.progress;
    var st = p.stats;
    var nameRow = el('label', { class: 'setting-row' });
    nameRow.appendChild(el('span', { text: T('Display name') }));
    var account = ctx.getAccountName ? ctx.getAccountName() : null;
    if (account) {
      // Hosted: the name comes from the platform profile (nickname) and is
      // not editable here; the free-text field is the offline fallback.
      nameRow.appendChild(el('strong', { text: account }));
      nameRow.appendChild(el('span', { class: 'dim', text: ' ' + T('(platform account)') }));
    } else {
      var input = el('input', { type: 'text', maxlength: '16', value: ctx.saveDoc.profileName || T('Guest'), 'aria-label': T('Display name') });
      input.addEventListener('change', function () { ctx.onName(input.value.trim().slice(0, 16) || T('Guest')); });
      nameRow.appendChild(input);
    }
    host.appendChild(nameRow);

    var grid = el('div', { class: 'stat-grid' });
    function stat(label, val) {
      var d = el('div', { class: 'stat' });
      d.appendChild(el('span', { class: 'stat-val', text: String(val) }));
      d.appendChild(el('span', { class: 'stat-label', text: T(label) }));
      grid.appendChild(d);
    }
    stat('Matches', st.rounds);
    stat('Wins', st.wins);
    stat('Boxes claimed', st.boxesClaimed);
    stat('Best chain', st.bestChain);
    stat('Journey stars', ctx.totalStars());
    stat('Time played', fmtTime(st.playMs));
    host.appendChild(grid);

    host.appendChild(el('h3', { text: T('Achievements') }));
    var ul = el('ul', { class: 'ach-list' });
    ctx.Store.ACHIEVEMENTS.forEach(function (a) {
      var got = !!p.achievements[a.key];
      ul.appendChild(el('li', { class: got ? '' : 'dim', text: (got ? '🏅 ' : '○ ') + T(a.name) + ' — ' + T(a.desc) }));
    });
    host.appendChild(ul);
  }

  // ---------- scores (local leaderboards) ----------
  function buildLeaderboard(host, ctx, data, tab) {
    host.innerHTML = '';
    var tabs = el('div', { class: 'seg', role: 'tablist' });
    Object.keys(data).forEach(function (k) {
      var b = el('button', { class: 'seg-btn' + (k === tab ? ' on' : ''), role: 'tab', 'aria-selected': k === tab ? 'true' : 'false', 'data-tab': k, text: T(k) });
      b.addEventListener('click', function () { ctx.onBoardTab(k); });
      tabs.appendChild(b);
    });
    host.appendChild(tabs);
    var entries = data[tab] || [];
    if (!entries.length) {
      host.appendChild(el('p', { class: 'dim', text: T('No verified scores yet — finish a ranked sheet to post one.') }));
      return;
    }
    var table = el('table', { class: 'breakdown' });
    var head = el('tr');
    ['#', 'Name', 'Score', 'Board', 'Time'].forEach(function (h) { head.appendChild(el('th', { text: T(h) })); });
    table.appendChild(head);
    entries.slice(0, 20).forEach(function (e, i) {
      var tr = el('tr');
      var board = e.board === 'platform' ? T('platform') : e.board;
      [String(i + 1), e.name, String(e.score), board, fmtTime(e.durationMs)].forEach(function (v) {
        tr.appendChild(el('td', { text: v }));
      });
      table.appendChild(tr);
    });
    host.appendChild(table);
  }

  root.BLUI = {
    el: el, fmtTime: fmtTime, starsText: starsText, T: T,
    playerName: playerName, levelName: levelName, goalText: goalText,
    buildTitle: buildTitle,
    buildPractice: buildPractice,
    buildJourney: buildJourney,
    buildChallenges: buildChallenges,
    buildLessonList: buildLessonList,
    buildResults: buildResults,
    buildSettingsForm: buildSettingsForm,
    buildHelp: buildHelp,
    buildProfile: buildProfile,
    buildLeaderboard: buildLeaderboard
  };
})(typeof self !== 'undefined' ? self : this);
