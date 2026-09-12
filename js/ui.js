/* Boxes & Lines — DOM builders for screens and overlays (semantic HTML
 * over/beside the canvas; the 3D scene is never the only UI).
 * Browser global: window.BLUI.
 */
(function (root) {
  'use strict';

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
        title: '▶ Play', primary: true,
        sub: 'Journey ' + (nextStage.index + 1) + ' — ' + nextStage.name,
        aria: 'Play next journey stage: ' + nextStage.name,
        onClick: function () { ctx.onPlay(nextStage); }
      }));
    } else {
      grid.appendChild(modeCard(ctx, {
        title: '▶ Play', primary: true, sub: 'Practice a fresh sheet',
        onClick: function () { ctx.onMode('practice'); }
      }));
    }
    var dateStr = Content.utcDateString(ctx.serverNow());
    var done = p.dailiesDone[dateStr];
    grid.appendChild(modeCard(ctx, {
      title: 'Daily Sheet',
      sub: done != null ? 'Done today — score ' + done : 'New shared sheet · ' + ctx.dailyCountdown(),
      onClick: function () { ctx.onDaily(); }
    }));
    grid.appendChild(modeCard(ctx, { title: 'Journey', sub: ctx.totalStars() + ' ★ earned', onClick: function () { ctx.onMode('journey'); } }));
    grid.appendChild(modeCard(ctx, { title: 'Practice', sub: 'Unranked, undo allowed', onClick: function () { ctx.onMode('practice'); } }));
    grid.appendChild(modeCard(ctx, { title: 'Challenge', sub: 'Constrained goals', onClick: function () { ctx.onMode('challenge'); } }));
    grid.appendChild(modeCard(ctx, { title: 'Learn', sub: 'Five short lessons', onClick: function () { ctx.onMode('learn'); } }));
    host.appendChild(grid);
    var row = el('div', { class: 'title-links' });
    [['Scores', 'scores'], ['Settings', 'settings'], ['Help', 'help'], ['Profile', 'profile']].forEach(function (l) {
      var b = el('button', { class: 'btn ghost', text: l[0] });
      b.addEventListener('click', function () { ctx.onMode(l[1]); });
      row.appendChild(b);
    });
    host.appendChild(row);
  }

  // ---------- practice setup ----------
  function buildPractice(host, ctx) {
    host.innerHTML = '';
    var Content = ctx.Content;
    var preset = Content.PRACTICE[0], ai = 'medium';
    var form = el('div', { class: 'setup-form' });
    form.appendChild(el('h3', { text: 'Sheet size' }));
    var presetRow = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Sheet size' });
    Content.PRACTICE.forEach(function (p, i) {
      var b = el('button', { class: 'seg-btn' + (i === 0 ? ' on' : ''), role: 'radio', 'aria-checked': i === 0 ? 'true' : 'false',
        text: p.name + ' · ' + p.rows + '×' + p.cols });
      b.addEventListener('click', function () {
        preset = p;
        presetRow.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
        b.classList.add('on'); b.setAttribute('aria-checked', 'true');
      });
      presetRow.appendChild(b);
    });
    form.appendChild(presetRow);
    form.appendChild(el('h3', { text: 'Rival' }));
    var aiRow = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Rival difficulty' });
    Content.AI_LEVELS.forEach(function (lv, i) {
      var b = el('button', { class: 'seg-btn' + (i === 1 ? ' on' : ''), role: 'radio', 'aria-checked': i === 1 ? 'true' : 'false',
        text: Content.AI_NAMES[lv] + ' · ' + lv });
      b.addEventListener('click', function () {
        ai = lv;
        aiRow.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
        b.classList.add('on'); b.setAttribute('aria-checked', 'true');
      });
      aiRow.appendChild(b);
    });
    form.appendChild(aiRow);
    form.appendChild(el('p', { class: 'dim', text: 'Practice is unranked: undo is allowed, ratings are untouched. Expect 2–8 minutes.' }));
    var start = el('button', { class: 'btn primary big', text: 'Start sheet' });
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
        'aria-label': 'Stage ' + (lv.index + 1) + ': ' + lv.name + (open ? ', ' + stars + ' stars' : ', locked'),
        'aria-disabled': open ? 'false' : 'true'
      });
      btn.appendChild(el('span', { class: 'level-num', text: String(lv.index + 1).padStart(2, '0') }));
      btn.appendChild(el('span', { class: 'level-name', text: lv.name }));
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
      var btn = el('button', { class: 'level-row', 'aria-label': c.name + '. ' + c.goalText });
      btn.appendChild(el('span', { class: 'level-name', text: c.name }));
      btn.appendChild(el('span', { class: 'level-meta', text: c.rows + '×' + c.cols + (c.timeLimitSec ? ' · ⏱' : '') }));
      btn.appendChild(el('span', { class: 'level-stars', text: best != null ? String(best) : '—' }));
      btn.appendChild(el('p', { class: 'level-goal', text: c.goalText }));
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
      var btn = el('button', { class: 'level-row', 'aria-label': 'Lesson ' + (i + 1) + ': ' + L.title + (done[L.id] ? ', complete' : '') });
      btn.appendChild(el('span', { class: 'level-num', text: String(i + 1) }));
      btn.appendChild(el('span', { class: 'level-name', text: L.title }));
      btn.appendChild(el('span', { class: 'level-stars', text: done[L.id] ? '✓' : '' }));
      btn.addEventListener('click', function () { ctx.onLesson(i); });
      list.appendChild(btn);
    });
    host.appendChild(list);
  }

  // ---------- results ----------
  function buildResults(host, ctx, r) {
    // r: {headline, sub, won, breakdown, stars, margin, cfg, canNext, entry}
    host.innerHTML = '';
    host.appendChild(el('h2', { class: r.won ? 'result-win' : 'result-lose', text: r.headline }));
    if (r.sub) host.appendChild(el('p', { class: 'dim', text: r.sub }));
    if (r.stars != null) {
      host.appendChild(el('div', { class: 'result-stars', 'aria-label': r.stars + ' of 3 stars', text: starsText(r.stars) }));
    }
    var table = el('table', { class: 'breakdown' });
    table.appendChild(el('caption', { text: 'Score breakdown' }));
    r.breakdown.components.forEach(function (c) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: c.label }));
      tr.appendChild(el('td', { class: 'num', text: String(c.points) }));
      table.appendChild(tr);
    });
    var total = el('tr', { class: 'total' });
    total.appendChild(el('td', { text: 'Total' }));
    total.appendChild(el('td', { class: 'num', text: String(r.breakdown.total) }));
    table.appendChild(total);
    host.appendChild(table);
    if (r.newAchievements && r.newAchievements.length) {
      var ul = el('ul', { class: 'ach-list', 'aria-label': 'Achievements unlocked' });
      r.newAchievements.forEach(function (a) {
        ul.appendChild(el('li', { text: '🏅 ' + a.name + ' — ' + a.desc }));
      });
      host.appendChild(ul);
    }
    var row = el('div', { class: 'btn-row' });
    var retry = el('button', { class: 'btn primary', text: '↻ Retry' });
    retry.addEventListener('click', ctx.onRetry);
    row.appendChild(retry);
    if (r.canNext) {
      var next = el('button', { class: 'btn', text: 'Next →' });
      next.addEventListener('click', ctx.onNext);
      row.appendChild(next);
    }
    var home = el('button', { class: 'btn ghost', text: 'Title' });
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
      var wrap = el('label', { class: 'setting-row' });
      wrap.appendChild(el('span', { text: label }));
      var input = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(s[key]), 'aria-label': label });
      input.addEventListener('input', function () { s[key] = parseFloat(input.value); ctx.onSettings(); });
      wrap.appendChild(input);
      return wrap;
    }
    function toggle(label, key) {
      var wrap = el('label', { class: 'setting-row' });
      wrap.appendChild(el('span', { text: label }));
      var input = el('input', { type: 'checkbox', 'aria-label': label });
      input.checked = !!s[key];
      input.addEventListener('change', function () { s[key] = input.checked; ctx.onSettings(); });
      wrap.appendChild(input);
      return wrap;
    }
    function choice(label, key, options) {
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
    host.appendChild(el('h3', { text: 'Audio' }));
    host.appendChild(slider('Music', 'music'));
    host.appendChild(slider('Effects', 'effects'));
    host.appendChild(slider('Ambience', 'ambience'));
    host.appendChild(toggle('Mute all', 'muted'));
    host.appendChild(toggle('Captions for sound cues', 'captions'));
    host.appendChild(el('h3', { text: 'Graphics' }));
    host.appendChild(choice('Quality tier', 'graphicsTier', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]));
    host.appendChild(choice('Desk theme', 'theme', Content.THEMES.map(function (t) {
      var locked = totalStars < t.unlockStars;
      return [t.id, t.name + (locked ? ' (🔒 ' + t.unlockStars + '★)' : '')];
    })));
    host.appendChild(toggle('Reduced motion', 'reducedMotion'));
    host.appendChild(toggle('High contrast', 'highContrast'));
    host.appendChild(choice('Player colors', 'colorPalette', [['standard', 'Standard'], ['high-visibility', 'High visibility']]));
    host.appendChild(el('h3', { text: 'Controls & access' }));
    host.appendChild(toggle('Larger text', 'largeText'));
    host.appendChild(toggle('Left-handed layout', 'leftHanded'));
    host.appendChild(toggle('Confirm moves (tap edge twice)', 'confirmMoves'));
    host.appendChild(toggle('Always show button board', 'boardMirror'));
    host.appendChild(toggle('Haptics', 'haptics'));
    var replay = el('button', { class: 'btn ghost', text: 'Replay lessons' });
    replay.addEventListener('click', function () { ctx.onMode('learn'); });
    host.appendChild(replay);
  }

  // ---------- help ----------
  function buildHelp(host, ctx) {
    host.innerHTML = '';
    var cards = [
      ['Draw a line', 'Tap a faint edge between two dots (or move the focus ring with arrow keys and press Enter). One line per turn.'],
      ['Claim a box', 'When your line closes the fourth side of a box, the box folds into your color and stamp — and you draw again.'],
      ['Extra turns chain', 'Claimed boxes grant another line immediately. Long chains swing a match; so can giving one away.'],
      ['The third side is a gift', 'A line that gives a box its third side usually hands it to your rival. The risk lamp warns you before you commit.'],
      ['Winning', 'When the sheet is full, most boxes wins. Ties break on fewer invalid moves, then faster time.'],
      ['Controls', 'Pointer/touch: tap an edge. Keyboard: arrows move the focus, Enter draws, U undo (practice), H hint, P pause, S skip animation, C reset camera. Gamepad: stick/d-pad moves focus, A draws, B cancels, Start pauses.']
    ];
    var grid = el('div', { class: 'help-grid' });
    cards.forEach(function (c) {
      var card = el('div', { class: 'help-card' });
      card.appendChild(el('h3', { text: c[0] }));
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
    nameRow.appendChild(el('span', { text: 'Display name' }));
    var account = ctx.getAccountName ? ctx.getAccountName() : null;
    if (account) {
      // Hosted: the name comes from the platform profile (nickname) and is
      // not editable here; the free-text field is the offline fallback.
      nameRow.appendChild(el('strong', { text: account }));
      nameRow.appendChild(el('span', { class: 'dim', text: ' (platform account)' }));
    } else {
      var input = el('input', { type: 'text', maxlength: '16', value: ctx.saveDoc.profileName || 'Guest', 'aria-label': 'Display name' });
      input.addEventListener('change', function () { ctx.onName(input.value.trim().slice(0, 16) || 'Guest'); });
      nameRow.appendChild(input);
    }
    host.appendChild(nameRow);

    var grid = el('div', { class: 'stat-grid' });
    function stat(label, val) {
      var d = el('div', { class: 'stat' });
      d.appendChild(el('span', { class: 'stat-val', text: String(val) }));
      d.appendChild(el('span', { class: 'stat-label', text: label }));
      grid.appendChild(d);
    }
    stat('Matches', st.rounds);
    stat('Wins', st.wins);
    stat('Boxes claimed', st.boxesClaimed);
    stat('Best chain', st.bestChain);
    stat('Journey stars', ctx.totalStars());
    stat('Time played', fmtTime(st.playMs));
    host.appendChild(grid);

    host.appendChild(el('h3', { text: 'Achievements' }));
    var ul = el('ul', { class: 'ach-list' });
    ctx.Store.ACHIEVEMENTS.forEach(function (a) {
      var got = !!p.achievements[a.key];
      ul.appendChild(el('li', { class: got ? '' : 'dim', text: (got ? '🏅 ' : '○ ') + a.name + ' — ' + a.desc }));
    });
    host.appendChild(ul);
  }

  // ---------- scores (local leaderboards) ----------
  function buildLeaderboard(host, ctx, data, tab) {
    host.innerHTML = '';
    var tabs = el('div', { class: 'seg', role: 'tablist' });
    Object.keys(data).forEach(function (k) {
      var b = el('button', { class: 'seg-btn' + (k === tab ? ' on' : ''), role: 'tab', 'aria-selected': k === tab ? 'true' : 'false', text: k });
      b.addEventListener('click', function () { ctx.onBoardTab(k); });
      tabs.appendChild(b);
    });
    host.appendChild(tabs);
    var entries = data[tab] || [];
    if (!entries.length) {
      host.appendChild(el('p', { class: 'dim', text: 'No verified scores yet — finish a ranked sheet to post one.' }));
      return;
    }
    var table = el('table', { class: 'breakdown' });
    var head = el('tr');
    ['#', 'Name', 'Score', 'Board', 'Time'].forEach(function (h) { head.appendChild(el('th', { text: h })); });
    table.appendChild(head);
    entries.slice(0, 20).forEach(function (e, i) {
      var tr = el('tr');
      [String(i + 1), e.name, String(e.score), e.board, fmtTime(e.durationMs)].forEach(function (v) {
        tr.appendChild(el('td', { text: v }));
      });
      table.appendChild(tr);
    });
    host.appendChild(table);
  }

  root.BLUI = {
    el: el, fmtTime: fmtTime, starsText: starsText,
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
