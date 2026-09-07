/* Boxes & Lines — app orchestrator.
 * Wires the plain-script globals (BLRules, BLContent, BLSession, BLStore,
 * BLAudio, BLUI) to the Three.js renderer (js/render.js), builds the DOM
 * shell, runs the screen manager, game flow, input (pointer/keyboard/
 * gamepad), the accessible button-board mirror, progression, and hosted play.
 */
import { createRenderer, webglAvailable } from './render.js';

(function () {
  'use strict';

  var Rules = window.BLRules, Content = window.BLContent, Session = window.BLSession,
      Store = window.BLStore, Audio = window.BLAudio, UI = window.BLUI;

  // ---------------------------------------------------------------- helpers

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, children) { return UI.el(tag, attrs, children); }

  var funnel = {};
  function track(event) { funnel[event] = (funnel[event] || 0) + 1; }

  var liveRegion, captionsEl, captionTimer, toastEl, toastTimer;

  function announce(text) {
    if (!liveRegion) return;
    liveRegion.textContent = '';
    liveRegion.textContent = text; // reassign so repeated text re-announces
  }

  function showCaption(text) {
    if (!captionsEl) return;
    captionsEl.textContent = text;
    captionsEl.classList.add('show');
    clearTimeout(captionTimer);
    captionTimer = setTimeout(function () { captionsEl.classList.remove('show'); }, 1500);
  }

  function showToast(text, actionLabel, actionFn) {
    if (!toastEl) return;
    toastEl.innerHTML = '';
    toastEl.appendChild(document.createTextNode(text));
    if (actionLabel && actionFn) {
      var b = el('button', { class: 'btn ghost', text: actionLabel });
      b.addEventListener('click', function () { hideToast(); actionFn(); });
      toastEl.appendChild(b);
    }
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actionLabel ? 8000 : 3000);
  }
  function hideToast() { if (toastEl) toastEl.classList.remove('show'); }

  var INVALID_TEXT = {};
  INVALID_TEXT[Rules.INVALID.ENDED] = 'The sheet is already finished.';
  INVALID_TEXT[Rules.INVALID.DRAWN] = 'That line is already drawn.';
  INVALID_TEXT[Rules.INVALID.BOUNDS] = 'That edge is off the sheet.';
  INVALID_TEXT[Rules.INVALID.BAD_CMD] = 'Unknown action.';
  INVALID_TEXT[Rules.INVALID.BAD_SHAPE] = 'Malformed action.';
  INVALID_TEXT[Rules.INVALID.WRONG_PLAYER] = 'Not your turn.';
  function invalidText(reason) { return INVALID_TEXT[reason] || 'That move is not allowed.'; }

  // ---------------------------------------------------------------- save doc

  var doc = Store.load();
  function saveDoc() { Store.save(doc); }

  function totalStars() {
    var s = 0, js = doc.progress.journeyStars;
    Object.keys(js).forEach(function (k) { s += js[k] || 0; });
    return s;
  }

  function applyBodyClasses() {
    var s = doc.settings, b = document.body;
    b.classList.toggle('reduced-motion', !!s.reducedMotion);
    b.classList.toggle('high-contrast', !!s.highContrast);
    b.classList.toggle('large-text', !!s.largeText);
    b.classList.toggle('left-handed', !!s.leftHanded);
    b.classList.toggle('palette-high-visibility', s.colorPalette === 'high-visibility');
  }

  function computeQuality() {
    var t = doc.settings.graphicsTier;
    if (t && t !== 'auto') return t;
    if ((navigator.hardwareConcurrency || 8) <= 4) return 'low';
    return (window.devicePixelRatio >= 2 && window.screen.width >= 1024) ? 'high' : 'medium';
  }

  function playerColors(n) {
    var hc = doc.settings.colorPalette === 'high-visibility';
    return Content.PLAYER_STYLES.slice(0, n || 4).map(function (s) { return hc ? s.colorHC : s.color; });
  }

  function themeFor(cfg) {
    var stars = totalStars();
    function pick(id) {
      var t = Content.THEMES.filter(function (x) { return x.id === id; })[0];
      return (t && stars >= t.unlockStars) ? t : null;
    }
    return (cfg && pick(cfg.theme)) || pick(doc.settings.theme) || Content.THEMES[0];
  }

  // ---------------------------------------------------------------- server clock

  var serverOffset = 0;
  function serverNow() { return Date.now() + serverOffset; }

  function syncServerClock() {
    var t0 = Date.now();
    fetch('/api/v1/time').then(function (r) {
      if (!r.ok) throw new Error('bad status');
      return r.json();
    }).then(function (data) {
      var mid = t0 + (Date.now() - t0) / 2;
      var serverMs = typeof data === 'number' ? data : (data.now != null ? data.now : data.time);
      if (typeof serverMs === 'string') serverMs = Date.parse(serverMs);
      if (isFinite(serverMs)) serverOffset = serverMs - mid;
    }).catch(function () { serverOffset = 0; });
  }

  function dailyCountdown() {
    var now = new Date(serverNow());
    var next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    var ms = Math.max(0, next - now.getTime());
    var h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    return 'resets in ' + h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  // ---------------------------------------------------------------- shell DOM

  function buildShell(root) {
    root.innerHTML = '';
    var shell = el('div', { id: 'app-shell' });
    var topbar = el('header', { id: 'topbar' });
    topbar.appendChild(el('div', { class: 'hud-block', id: 'hud-objective' }, [
      el('h2', { id: 'objective-text' }), el('p', { id: 'objective-sub', class: 'dim' })
    ]));
    topbar.appendChild(el('div', { class: 'hud-block', id: 'hud-status' }, [
      el('div', { id: 'turn-indicator' }), el('div', { id: 'score-strip' }), el('div', { id: 'clock' })
    ]));
    topbar.appendChild(el('div', { class: 'hud-block', id: 'hud-actions' }, [
      el('button', { id: 'btn-hint', class: 'btn', text: 'Hint' }),
      el('button', { id: 'btn-undo', class: 'btn', text: 'Undo' }),
      el('button', { id: 'btn-skip', class: 'btn', text: 'Skip' }),
      el('button', { id: 'btn-pause', class: 'btn', text: 'Pause' })
    ]));
    shell.appendChild(topbar);
    shell.appendChild(el('div', { id: 'play-region' }, [
      el('div', { id: 'scene-host', role: 'application', 'aria-label': '3D board view' }),
      el('div', { id: 'board-mirror' })
    ]));
    root.appendChild(shell);

    var overlay = el('div', { id: 'screen-overlay', hidden: '' });
    overlay.appendChild(el('section', {
      id: 'screen-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'screen-title'
    }, [
      el('div', { id: 'screen-head' }, [
        el('button', { id: 'screen-back', class: 'btn ghost', text: '← Back' }),
        el('h1', { id: 'screen-title' })
      ]),
      el('div', { id: 'screen-body' })
    ]));
    root.appendChild(overlay);

    var pause = el('div', { id: 'pause-overlay', hidden: '' });
    pause.appendChild(el('section', {
      id: 'pause-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pause-title'
    }, [
      el('h1', { id: 'pause-title', text: 'Paused' }),
      el('div', { class: 'btn-col' }, [
        el('button', { id: 'btn-resume', class: 'btn primary', text: 'Resume' }),
        el('button', { id: 'btn-pause-settings', class: 'btn', text: 'Settings' }),
        el('button', { id: 'btn-pause-help', class: 'btn', text: 'Help' }),
        el('button', { id: 'btn-leave', class: 'btn ghost', text: 'Leave sheet' })
      ])
    ]));
    root.appendChild(pause);

    root.appendChild(el('div', { id: 'live-region', class: 'visually-hidden', 'aria-live': 'polite' }));
    root.appendChild(el('div', { id: 'captions', 'aria-hidden': 'true' }));
    root.appendChild(el('div', { id: 'toast', role: 'status' }));

    liveRegion = $('live-region'); captionsEl = $('captions'); toastEl = $('toast');
  }

  // ---------------------------------------------------------------- renderer

  var renderer = null;

  function initRenderer() {
    var host = $('scene-host');
    if (!webglAvailable()) {
      host.innerHTML = '';
      host.appendChild(el('div', { class: 'compat-msg', role: 'note' }, [
        el('h2', { text: '3D unavailable — playing with the button board' }),
        el('p', { text: 'Your browser could not provide WebGL. The full game remains playable below: every edge is a button, and keyboard, gamepad, and touch all work.' })
      ]));
      return;
    }
    try {
      renderer = createRenderer(host, {
        palette: themeFor(null).palette,
        playerColors: playerColors(4),
        reducedMotion: !!doc.settings.reducedMotion,
        quality: computeQuality(),
        onPick: onPick,
        onHover: onHover
      });
    } catch (e) {
      renderer = null;
      track('error');
      host.innerHTML = '';
      host.appendChild(el('div', { class: 'compat-msg', role: 'note' }, [
        el('h2', { text: '3D unavailable — playing with the button board' }),
        el('p', { text: 'The 3D view failed to start. The button board below is fully playable.' })
      ]));
    }
  }

  function rCall(name, a, b, c, d) {
    if (renderer && renderer[name]) {
      try { return renderer[name](a, b, c, d); } catch (e) { /* cosmetic layer must never break play */ }
    }
  }

  // ---------------------------------------------------------------- app state

  var appState = 'boot'; // boot → title → mode-select → preparing → active ↔ paused → resolving → results → progression
  var sess = null, curCfg = null, curLesson = null;
  var cmdCounter = 0;
  var aiGen = 0, aiTimer = null;
  var tickTimer = null, lastTickSecond = -1;
  var paused = false;
  var armedEdge = null;       // confirm-moves arming
  var focusEdge = null;       // keyboard/gamepad focus
  var chainNow = 0, bestChainGame = 0;
  var lessonCount = 0, lessonDone = false;
  var lastAnnouncedPlayer = -1;
  var hosted = null;          // {id} when a hosted session is active
  var lastResultsCfg = null;

  function cancelAi() { aiGen++; if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; } }

  function gameRunning() { return sess && appState === 'active' && !paused && !document.hidden; }

  // A sheet the player can still return to (results/progression do not count).
  function inPlay() { return !!sess && (appState === 'active' || appState === 'paused'); }

  // ---------------------------------------------------------------- screens

  var SCREEN_TITLES = {
    title: 'Boxes & Lines', practice: 'Practice', journey: 'Journey', challenge: 'Challenge',
    learn: 'Learn', settings: 'Settings', help: 'Help', profile: 'Profile',
    scores: 'Scores', results: 'Results', hosted: 'Hosted play'
  };
  var currentScreen = null, lastFocus = null, scoresTab = 'Global', dailySubEl = null;

  function overlayOpen() { return !$('screen-overlay').hidden; }

  function showScreen(name, data) {
    currentScreen = name;
    var body = $('screen-body');
    $('screen-title').textContent = SCREEN_TITLES[name] || name;
    dailySubEl = null;
    switch (name) {
      case 'title': UI.buildTitle(body, ctx); appendHostedCard(body); tagDailySub(body); break;
      case 'practice': UI.buildPractice(body, ctx); break;
      case 'journey': UI.buildJourney(body, ctx); break;
      case 'challenge': UI.buildChallenges(body, ctx); break;
      case 'learn': UI.buildLessonList(body, ctx); break;
      case 'settings': UI.buildSettingsForm(body, ctx); break;
      case 'help': UI.buildHelp(body, ctx); break;
      case 'profile': UI.buildProfile(body, ctx); break;
      case 'scores': UI.buildLeaderboard(body, ctx, { Global: Store.loadBoards().entries }, scoresTab); break;
      case 'results': UI.buildResults(body, ctx, data); break;
      case 'hosted': buildHostedForm(body); break;
    }
    var ov = $('screen-overlay');
    if (ov.hidden) {
      lastFocus = document.activeElement;
      ov.hidden = false;
    }
    $('screen-back').hidden = (name === 'title' && !inPlay());
    $('screen-panel').setAttribute('tabindex', '-1');
    $('screen-panel').focus();
    syncInert();
  }

  function closeScreen() {
    $('screen-overlay').hidden = true;
    currentScreen = null;
    if (paused) $('pause-overlay').hidden = false;
    syncInert();
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;
  }

  // While a modal dialog is up the shell behind it must not be reachable by
  // tab, pointer, or the HUD buttons (Hint/Undo used to fire while paused).
  function syncInert() {
    var shell = $('app-shell');
    if (!shell) return;
    var modal = !$('screen-overlay').hidden || !$('pause-overlay').hidden;
    if ('inert' in HTMLElement.prototype) shell.inert = modal;
    else if (modal) shell.setAttribute('aria-hidden', 'true');
    else shell.removeAttribute('aria-hidden');
  }

  // The "← Back" affordance, shared by the button and the Escape key.
  function screenBack() {
    if (paused) { closeScreen(); return; } // closeScreen re-shows pause overlay
    if (currentScreen === 'title') { if (inPlay()) closeScreen(); return; }
    if (!inPlay()) teardownGame(); // leaving a finished sheet for good
    showScreen('title');
  }

  function tagDailySub(body) {
    var cards = body.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) {
      var t = cards[i].querySelector('.card-title');
      if (t && t.textContent === 'Daily Sheet') { dailySubEl = cards[i].querySelector('.card-sub'); return; }
    }
  }

  // Title refresh: countdown tick while the title screen is visible.
  setInterval(function () {
    if (currentScreen === 'title' && dailySubEl && overlayOpen()) {
      var dateStr = Content.utcDateString(serverNow());
      if (doc.progress.dailiesDone[dateStr] == null) dailySubEl.textContent = 'New shared sheet · ' + dailyCountdown();
    }
  }, 1000);

  // ---------------------------------------------------------------- ctx for BLUI

  var ctx = {
    Content: Content,
    Store: Store,
    saveDoc: doc,
    serverNow: serverNow,
    dailyCountdown: dailyCountdown,
    totalStars: totalStars,
    onPlay: function (cfg) { closeScreen(); startGame(cfg); },
    onMode: function (name) {
      if (appState === 'boot') appState = 'title';
      if (['practice', 'journey', 'challenge', 'learn'].indexOf(name) >= 0 && appState === 'title') appState = 'mode-select';
      showScreen(name);
    },
    onDaily: function () {
      var dateStr = Content.utcDateString(serverNow());
      var cfg = Content.dailyConfig(dateStr);
      closeScreen();
      startGame(cfg); // replay allowed; best score kept on save
    },
    onLesson: function (i) {
      var lesson = Content.tutorialLessons()[i];
      if (!lesson) return;
      closeScreen();
      startGame(lesson.cfg, lesson);
    },
    onSettings: function () {
      applyBodyClasses();
      rCall('setReducedMotion', !!doc.settings.reducedMotion);
      rCall('setQuality', computeQuality());
      rCall('setPalette', themeFor(sess ? curCfg : null).palette, playerColors(sess ? sess.state.players.length : 4));
      Audio.applySettings(doc.settings);
      Audio.setCaptions(doc.settings.captions, showCaption);
      document.body.classList.toggle('mirror-emphasis', !!doc.settings.boardMirror);
      saveDoc();
      track('settings-change');
    },
    onName: function (n) { doc.profileName = n; saveDoc(); announce('Display name set to ' + n); },
    onRetry: function () {
      track('retry');
      closeScreen();
      if (lastResultsCfg) startGame(lastResultsCfg.cfg, lastResultsCfg.lesson);
    },
    onNext: function () {
      closeScreen();
      if (lastResultsCfg && lastResultsCfg.lesson) {
        var lessons = Content.tutorialLessons();
        var idx = lessons.indexOf(lastResultsCfg.lesson);
        if (idx >= 0 && idx + 1 < lessons.length) { startGame(lessons[idx + 1].cfg, lessons[idx + 1]); return; }
        showScreen('learn');
        return;
      }
      if (curCfg && curCfg.kind === 'journey') {
        var next = Content.JOURNEY[curCfg.index + 1];
        if (next) { startGame(next); return; }
      }
      showScreen('title');
    },
    onTitle: function () { closeScreen(); teardownGame(); goTitle(); },
    onBoardTab: function (k) { scoresTab = k; showScreen('scores'); }
  };

  function goTitle() {
    appState = 'title';
    showScreen('title');
  }

  // ---------------------------------------------------------------- game flow

  function startGame(cfg, lesson) {
    cancelAi();
    stopTick();
    appState = 'preparing';
    hosted = null;
    sess = Session.create(cfg, cfg.kind);
    curCfg = sess.cfg;
    curLesson = lesson || null;
    if (lesson) Content.applyLessonFixture(sess.state, lesson, Rules);
    cmdCounter = 0;
    armedEdge = null; focusEdge = null;
    chainNow = 0; bestChainGame = 0;
    lessonCount = 0; lessonDone = false;
    lastAnnouncedPlayer = -1;
    paused = false;

    var theme = themeFor(curCfg);
    buildMirror(sess.state.rows, sess.state.cols);
    rCall('setBoard', sess.state.rows, sess.state.cols, sess.state.holes);
    rCall('setPalette', theme.palette, playerColors(sess.state.players.length));
    rCall('syncState', sess.state);
    rCall('setTurn', sess.state.current);
    rCall('resetCamera');
    syncMirror();

    $('pause-overlay').hidden = true;
    appState = 'active';
    syncInert();
    updateHUD();
    announce(curCfg.name + '. ' + objectiveText());
    if (curCfg.intro) showToast(curCfg.intro);
    startTick();
    scheduleAiIfNeeded();
    track('start');
  }

  function teardownGame() {
    cancelAi();
    stopTick();
    sess = null; curCfg = null; curLesson = null; hosted = null;
    paused = false;
    armedEdge = null; focusEdge = null;
    $('pause-overlay').hidden = true;
    syncInert();
    rCall('setPreview', null, -1, -1, null);
    rCall('setFocusEdge', null);
    $('objective-text').textContent = '';
    $('objective-sub').textContent = '';
    $('turn-indicator').textContent = '';
    $('score-strip').innerHTML = '';
    $('clock').textContent = '';
  }

  function objectiveText() {
    if (curLesson) return curLesson.text;
    return (curCfg && (curCfg.goalText || curCfg.intro)) || 'Claim the most boxes';
  }

  // ---------------------------------------------------------------- HUD

  function updateHUD() {
    if (!sess) return;
    var st = sess.state;
    $('objective-text').textContent = objectiveText();

    var sub;
    if (curLesson) {
      sub = curLesson.goal.count > 1 ? ('Progress: ' + Math.min(lessonCount, curLesson.goal.count) + ' / ' + curLesson.goal.count) : '';
    } else if (Session.isHumanTurn(sess)) {
      sub = 'Your turn — pick an edge';
    } else if (!st.over) {
      sub = st.players[st.current].name + ' is drawing…';
    } else {
      sub = '';
    }
    $('objective-sub').textContent = sub;

    // turn indicator + score strip
    $('turn-indicator').textContent = st.over ? 'Sheet complete' :
      (Session.isHumanTurn(sess) ? 'Your turn' : st.players[st.current].name + '’s turn');
    var strip = $('score-strip');
    strip.innerHTML = '';
    st.players.forEach(function (p, i) {
      var style = Content.PLAYER_STYLES[i % Content.PLAYER_STYLES.length];
      var chip = el('span', { class: 'player-chip player-' + i + (i === st.current && !st.over ? ' active' : '') }, [
        el('span', { class: 'chip-icon', text: style.icon, 'aria-hidden': 'true' }),
        el('span', { class: 'chip-name', text: p.name }),
        el('span', { class: 'chip-score', text: String(st.scores[i]) })
      ]);
      strip.appendChild(chip);
    });

    updateClock();
    $('btn-undo').disabled = !Session.canUndo(sess);
    $('btn-hint').disabled = !(sess.cfg.mechanics.hint && Session.isHumanTurn(sess));

    if (st.current !== lastAnnouncedPlayer && !st.over) {
      lastAnnouncedPlayer = st.current;
      announce(Session.isHumanTurn(sess) ? 'Your turn' : st.players[st.current].name + '’s turn');
    }
  }

  function updateClock() {
    if (!sess) { $('clock').textContent = ''; return; }
    var limit = sess.cfg.timeLimitSec;
    if (limit) {
      var remain = Math.max(0, limit * 1000 - sess.elapsedMs);
      $('clock').textContent = '⏱ ' + UI.fmtTime(remain);
      var sec = Math.ceil(remain / 1000);
      if (remain > 0 && remain <= 10000 && sec !== lastTickSecond) {
        lastTickSecond = sec;
        Audio.play('tick');
      }
    } else {
      $('clock').textContent = UI.fmtTime(sess.elapsedMs);
    }
  }

  // ---------------------------------------------------------------- events / sounds

  function handleEvents(events) {
    events.forEach(function (ev) {
      switch (ev.type) {
        case 'draw':
          Audio.play(ev.gives ? 'danger' : 'draw');
          break;
        case 'box':
          Audio.play(ev.player === 0 ? 'box' : 'box-rival');
          if (ev.player === 0) {
            chainNow++;
            if (chainNow > bestChainGame) bestChainGame = chainNow;
            if (doc.settings.haptics && navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
          }
          break;
        case 'pass':
          chainNow = 0;
          break;
        case 'extra-turn':
          Audio.play('extra');
          break;
      }
      if (curLesson && !lessonDone) {
        var g = curLesson.goal, match = false;
        if (g.event === 'draw-safe') match = ev.type === 'draw' && ev.gives === false;
        else if (g.event === 'box') match = ev.type === 'box';
        else if (g.event === 'draw') match = ev.type === 'draw';
        else if (g.event === 'extra-turn') match = ev.type === 'extra-turn';
        else if (g.event === 'over') match = ev.type === 'over';
        if (match) {
          lessonCount++;
          if (lessonCount >= g.count) {
            lessonDone = true;
            doc.progress.tutorialDone[curLesson.id] = true;
            saveDoc();
            track('tutorial-step');
          }
        }
      }
    });
  }

  function afterStateChange() {
    armedEdge = null;
    rCall('syncState', sess.state);
    rCall('setTurn', sess.state.current);
    syncMirror();
    updateHUD();
    if (sess.state.over) { finishGame(); return; }
    if (curLesson && lessonDone) { finishLesson(); return; }
    scheduleAiIfNeeded();
  }

  // ---------------------------------------------------------------- AI pacing

  function scheduleAiIfNeeded() {
    cancelAi();
    if (!gameRunning() || sess.state.over) return;
    if (sess.state.players[sess.state.current].type !== 'ai') return;
    var gen = aiGen;
    aiTimer = setTimeout(function () { runAiStep(gen); }, 450);
  }

  function runAiStep(gen) {
    if (gen !== aiGen || !gameRunning()) return;
    var res = Session.aiStep(sess);
    if (res && res.ok) {
      handleEvents(res.events);
      rCall('animateEvents', res.events);
      afterStateChange(); // reschedules while still AI
    }
  }

  // ---------------------------------------------------------------- tick

  function startTick() {
    stopTick();
    lastTickSecond = -1;
    tickTimer = setInterval(function () {
      if (!gameRunning()) return;
      var res = Session.tick(sess, 250);
      if (res && res.ok) {
        handleEvents(res.events);
        rCall('animateEvents', res.events);
        afterStateChange();
        return;
      }
      updateClock();
    }, 250);
  }
  function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }

  // ---------------------------------------------------------------- human input

  function onPick(dir, r, c) {
    if (!sess || appState !== 'active' || paused) return;
    if (!Session.isHumanTurn(sess)) {
      Audio.play('invalid');
      return;
    }
    // Reject up front so "confirm moves" never asks the player to confirm a
    // line that cannot be drawn (3D hit targets stay live on drawn edges).
    var bad = Rules.checkDraw(sess.state, dir, r, c);
    if (bad) {
      armedEdge = null;
      rCall('setPreview', null, -1, -1, null);
      Audio.play('invalid');
      var badMsg = invalidText(bad);
      showToast(badMsg);
      announce(badMsg);
      return;
    }
    if (doc.settings.confirmMoves) {
      if (armedEdge && armedEdge.dir === dir && armedEdge.r === r && armedEdge.c === c) {
        commitDraw(dir, r, c);
      } else {
        armedEdge = { dir: dir, r: r, c: c };
        var pv = Rules.previewDraw(sess.state, dir, r, c);
        rCall('setPreview', dir, r, c, pv ? (pv.claims.length ? 'claim' : pv.gives ? 'risky' : 'ok') : 'ok');
        showToast('Tap again to confirm');
      }
      return;
    }
    commitDraw(dir, r, c);
  }

  function commitDraw(dir, r, c) {
    if (!sess || sess.state.over) return;
    cancelAi();
    Session.checkpoint(sess);
    var cmd = { id: 'c' + (++cmdCounter), type: 'draw', dir: dir, r: r, c: c, player: sess.state.current };
    if (hosted) { hostedMove(cmd); return; }
    var res = Session.apply(sess, cmd);
    if (!res.ok) {
      Audio.play('invalid');
      var msg = invalidText(res.reason);
      showToast(msg);
      announce(msg);
      return;
    }
    handleEvents(res.events);
    rCall('animateEvents', res.events);
    rCall('setPreview', null, -1, -1, null);
    afterStateChange();
  }

  function onHover(dir, r, c) {
    if (!sess || appState !== 'active' || paused || !Session.isHumanTurn(sess)) return;
    if (dir === null || r < 0) {
      rCall('setPreview', null, -1, -1, null);
      updateHUD(); // restores the turn prompt, or lesson progress during Learn
      return;
    }
    if (Rules.checkDraw(sess.state, dir, r, c)) return;
    var pv = Rules.previewDraw(sess.state, dir, r, c);
    var kind = pv.claims.length ? 'claim' : pv.gives ? 'risky' : 'ok';
    rCall('setPreview', dir, r, c, kind);
    $('objective-sub').textContent =
      kind === 'claim' ? 'Claims a box — draw again!' :
      kind === 'risky' ? 'Risky: gives away a box' : 'Safe line';
  }

  // ---------------------------------------------------------------- HUD buttons

  function wireHudButtons() {
    $('btn-undo').addEventListener('click', doUndo);
    $('btn-hint').addEventListener('click', doHint);
    $('btn-skip').addEventListener('click', function () {
      rCall('skipAnimations');
      Audio.play('ui');
      announce('Animations skipped');
    });
    $('btn-pause').addEventListener('click', function () { if (sess && appState === 'active') pauseGame(); });
    $('btn-resume').addEventListener('click', resumeGame);
    $('btn-pause-settings').addEventListener('click', function () { $('pause-overlay').hidden = true; syncInert(); showScreen('settings'); });
    $('btn-pause-help').addEventListener('click', function () { $('pause-overlay').hidden = true; syncInert(); showScreen('help'); });
    $('btn-leave').addEventListener('click', function () {
      if (hosted) hostedResign(true);
      closeScreen();
      teardownGame();
      goTitle();
    });
    $('screen-back').addEventListener('click', screenBack);
  }

  function doUndo() {
    if (!sess || !Session.canUndo(sess)) return;
    cancelAi();
    if (Session.undo(sess)) {
      armedEdge = null;
      Audio.play('undo');
      rCall('syncState', sess.state);
      rCall('setTurn', sess.state.current);
      rCall('setPreview', null, -1, -1, null);
      syncMirror();
      updateHUD();
      announce('Move undone. Your turn.');
    }
  }

  function doHint() {
    if (!sess || !sess.cfg.mechanics.hint || !Session.isHumanTurn(sess)) return;
    var m = Session.hint(sess);
    if (!m) return;
    rCall('setFocusEdge', m.dir, m.r, m.c);
    flashMirrorHint(m);
    Audio.play('hint');
    announce('Hint: try the ' + edgeLabel(m.dir, m.r, m.c));
  }

  // ---------------------------------------------------------------- pause

  function pauseGame() {
    if (!sess || appState !== 'active' || paused) return;
    paused = true;
    appState = 'paused';
    cancelAi();
    stopTick();
    $('pause-overlay').hidden = false;
    syncInert();
    syncResignButton();
    $('btn-resume').focus();
    announce('Paused');
  }

  function resumeGame() {
    if (!paused) return;
    paused = false;
    appState = 'active';
    $('pause-overlay').hidden = true;
    syncInert();
    startTick();
    scheduleAiIfNeeded();
    announce('Resumed. ' + (Session.isHumanTurn(sess) ? 'Your turn.' : ''));
  }

  function syncResignButton() {
    var col = $('pause-panel').querySelector('.btn-col');
    var old = $('btn-resign');
    if (old) old.remove();
    if (hosted) {
      var b = el('button', { id: 'btn-resign', class: 'btn ghost', text: 'Resign match' });
      b.addEventListener('click', function () { hostedResign(false); });
      col.appendChild(b);
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      Audio.suspend();
      if (sess && appState === 'active' && !paused && !hosted) pauseGame();
    } else {
      Audio.resume();
    }
  });

  // ---------------------------------------------------------------- keyboard

  function edgeLabel(dir, r, c) {
    return (dir === 'h' ? 'horizontal' : 'vertical') + ' edge row ' + (r + 1) + ' column ' + (c + 1);
  }

  function edgePos(e) {
    return e.dir === 'h' ? { x: e.c + 0.5, y: e.r } : { x: e.c, y: e.r + 0.5 };
  }

  function setFocus(e) {
    focusEdge = e;
    rCall('setFocusEdge', e ? e.dir : null, e ? e.r : 0, e ? e.c : 0);
    syncMirrorFocus();
    if (e) announce(edgeLabel(e.dir, e.r, e.c));
  }

  function moveFocus(dx, dy) {
    if (!sess) return;
    var legal = Rules.legalActions(sess.state);
    if (!legal.length) return;
    if (!focusEdge) { setFocus(legal[0]); return; }
    var cur = edgePos(focusEdge), best = null, bestScore = Infinity;
    legal.forEach(function (e) {
      var p = edgePos(e);
      var ddx = p.x - cur.x, ddy = p.y - cur.y;
      var primary = dx ? ddx * dx : ddy * dy;
      if (primary <= 0.01) return;
      var perp = dx ? Math.abs(ddy) : Math.abs(ddx);
      var score = primary + perp * 3;
      if (score < bestScore) { bestScore = score; best = e; }
    });
    if (best) setFocus(best);
  }

  function firstLastEdge(last) {
    var legal = sess ? Rules.legalActions(sess.state) : [];
    if (legal.length) setFocus(last ? legal[legal.length - 1] : legal[0]);
  }

  // Escape dismisses the screen dialog wherever a back action exists.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !overlayOpen()) return;
    if ($('screen-back').hidden) return;
    e.preventDefault();
    screenBack();
  });

  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented) return; // a dialog already consumed this key
    if (!sess || appState !== 'active' && appState !== 'paused') return;
    if (overlayOpen()) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    var k = e.key;
    if (k === 'p' || k === 'P' || k === 'Escape') {
      e.preventDefault();
      if (paused) resumeGame(); else pauseGame();
      return;
    }
    if (paused || !Session.isHumanTurn(sess)) return;
    switch (k) {
      case 'ArrowLeft': e.preventDefault(); moveFocus(-1, 0); break;
      case 'ArrowRight': e.preventDefault(); moveFocus(1, 0); break;
      case 'ArrowUp': e.preventDefault(); moveFocus(0, -1); break;
      case 'ArrowDown': e.preventDefault(); moveFocus(0, 1); break;
      case 'Home': e.preventDefault(); firstLastEdge(false); break;
      case 'End': e.preventDefault(); firstLastEdge(true); break;
      case 'Enter': case ' ':
        if (focusEdge) { e.preventDefault(); onPick(focusEdge.dir, focusEdge.r, focusEdge.c); }
        break;
      case 'u': case 'U': e.preventDefault(); doUndo(); break;
      case 'h': case 'H': e.preventDefault(); doHint(); break;
      case 's': case 'S': e.preventDefault(); rCall('skipAnimations'); break;
      case 'c': case 'C': e.preventDefault(); rCall('resetCamera'); break;
    }
  });

  // ---------------------------------------------------------------- gamepad

  var padPrev = { ax: 0, ay: 0, buttons: [] }, padRepeatAt = 0;
  setInterval(function () {
    if (!sess || appState !== 'active' && appState !== 'paused') return;
    if (overlayOpen() || !navigator.getGamepads) return;
    var gp = navigator.getGamepads()[0];
    if (!gp) return;
    var now = Date.now();
    var ax = Math.abs(gp.axes[0]) > 0.5 ? Math.sign(gp.axes[0]) : 0;
    var ay = Math.abs(gp.axes[1]) > 0.5 ? Math.sign(gp.axes[1]) : 0;
    var b = gp.buttons;
    var dirX = (b[15] && b[15].pressed) ? 1 : (b[14] && b[14].pressed) ? -1 : ax;
    var dirY = (b[13] && b[13].pressed) ? 1 : (b[12] && b[12].pressed) ? -1 : ay;
    var moved = (dirX || dirY) && (dirX !== padPrev.ax || dirY !== padPrev.ay || now >= padRepeatAt);
    if (moved && !paused && Session.isHumanTurn(sess)) {
      moveFocus(dirX, dirY);
      padRepeatAt = now + 180;
    }
    padPrev.ax = dirX; padPrev.ay = dirY;
    function pressed(i) { return b[i] && b[i].pressed && !padPrev.buttons[i]; }
    if (pressed(0) && !paused && focusEdge && Session.isHumanTurn(sess)) onPick(focusEdge.dir, focusEdge.r, focusEdge.c);
    if (pressed(1) && !paused) { armedEdge = null; rCall('setPreview', null, -1, -1, null); }
    if (pressed(9)) { if (paused) resumeGame(); else pauseGame(); }
    padPrev.buttons = b.map(function (x) { return x.pressed; });
  }, 100);

  // ---------------------------------------------------------------- board mirror

  var mirrorBtns = {}; // "dir,r,c" -> button
  var mirrorCells = {}; // "r,c" -> box div

  function buildMirror(rows, cols) {
    var host = $('board-mirror');
    host.innerHTML = '';
    mirrorBtns = {}; mirrorCells = {};
    host.appendChild(el('h2', { class: 'visually-hidden', text: 'Button board' }));
    var grid = el('div', { class: 'mirror-grid', role: 'group', 'aria-label': 'Button board' });
    var tCols = [], tRows = [], i;
    for (i = 0; i <= cols * 2; i++) tCols.push(i % 2 === 0 ? '12px' : 'minmax(30px, 1fr)');
    for (i = 0; i <= rows * 2; i++) tRows.push(i % 2 === 0 ? '12px' : 'minmax(30px, 1fr)');
    grid.style.gridTemplateColumns = tCols.join(' ');
    grid.style.gridTemplateRows = tRows.join(' ');
    var r, c;
    for (r = 0; r <= rows; r++)
      for (c = 0; c <= cols; c++) {
        var dot = el('span', { class: 'mirror-dot', 'aria-hidden': 'true' });
        dot.style.gridRow = String(r * 2 + 1); dot.style.gridColumn = String(c * 2 + 1);
        grid.appendChild(dot);
      }
    for (r = 0; r <= rows; r++)
      for (c = 0; c < cols; c++) grid.appendChild(mirrorEdge('h', r, c));
    for (r = 0; r < rows; r++)
      for (c = 0; c <= cols; c++) grid.appendChild(mirrorEdge('v', r, c));
    for (r = 0; r < rows; r++)
      for (c = 0; c < cols; c++) {
        var cell = el('div', { class: 'mirror-cell', 'aria-hidden': 'true' });
        cell.style.gridRow = String(r * 2 + 2); cell.style.gridColumn = String(c * 2 + 2);
        mirrorCells[r + ',' + c] = cell;
        grid.appendChild(cell);
      }
    host.appendChild(grid);
    document.body.classList.toggle('mirror-emphasis', !!doc.settings.boardMirror);
  }

  function mirrorEdge(dir, r, c) {
    var b = el('button', { class: 'edge-btn ' + dir, type: 'button', 'aria-label': edgeLabel(dir, r, c) });
    b.style.gridRow = String(dir === 'h' ? r * 2 + 1 : r * 2 + 2);
    b.style.gridColumn = String(dir === 'h' ? c * 2 + 2 : c * 2 + 1);
    b.addEventListener('click', function () { onPick(dir, r, c); });
    mirrorBtns[dir + ',' + r + ',' + c] = b;
    return b;
  }

  function syncMirror() {
    if (!sess) return;
    var st = sess.state, r, c;
    for (r = 0; r <= st.rows; r++)
      for (c = 0; c < st.cols; c++) syncMirrorEdge('h', r, c, st.he[r][c]);
    for (r = 0; r < st.rows; r++)
      for (c = 0; c <= st.cols; c++) syncMirrorEdge('v', r, c, st.ve[r][c]);
    for (r = 0; r < st.rows; r++)
      for (c = 0; c < st.cols; c++) {
        var cell = mirrorCells[r + ',' + c];
        if (!cell) continue;
        var v = st.cells[r][c];
        cell.className = 'mirror-cell' + (v === -2 ? ' hole' : v >= 0 ? ' claimed player-' + v : '');
      }
  }

  function syncMirrorEdge(dir, r, c, v) {
    var b = mirrorBtns[dir + ',' + r + ',' + c];
    if (!b) return;
    var base = 'edge-btn ' + dir;
    if (v === 0) {
      b.className = base;
      b.disabled = false;
      b.setAttribute('aria-label', edgeLabel(dir, r, c));
    } else if (v === -1) {
      b.className = base + ' drawn pre';
      b.disabled = true;
      b.setAttribute('aria-label', edgeLabel(dir, r, c) + ', pre-drawn');
    } else {
      var name = sess.state.players[v - 1] ? sess.state.players[v - 1].name : 'player ' + v;
      b.className = base + ' drawn player-' + (v - 1);
      b.disabled = true;
      b.setAttribute('aria-label', edgeLabel(dir, r, c) + ', drawn by ' + name);
    }
  }

  function syncMirrorFocus() {
    Object.keys(mirrorBtns).forEach(function (k) { mirrorBtns[k].classList.remove('focused'); });
    if (focusEdge) {
      var b = mirrorBtns[focusEdge.dir + ',' + focusEdge.r + ',' + focusEdge.c];
      if (b) b.classList.add('focused');
    }
  }

  function flashMirrorHint(m) {
    var b = mirrorBtns[m.dir + ',' + m.r + ',' + m.c];
    if (!b) return;
    b.classList.add('hinted');
    setTimeout(function () { b.classList.remove('hinted'); }, 1600);
  }

  // ---------------------------------------------------------------- game end

  function finishLesson() {
    cancelAi();
    stopTick();
    appState = 'resolving';
    sess.active = false;
    Audio.play('win');
    announce('Lesson complete: ' + curLesson.title);
    var lessons = Content.tutorialLessons();
    var idx = lessons.indexOf(curLesson);
    lastResultsCfg = { cfg: curCfg, lesson: curLesson };
    appState = 'results';
    showScreen('results', {
      headline: 'Lesson complete',
      sub: curLesson.title,
      won: true,
      breakdown: { components: [], total: 0 },
      stars: null,
      newAchievements: [],
      canNext: idx >= 0 && idx + 1 < lessons.length
    });
    appState = 'progression';
  }

  function finishGame() {
    cancelAi();
    stopTick();
    appState = 'resolving';
    var st = sess.state;
    var out = Rules.outcome(st);

    if (curLesson && lessonDone) { finishLesson(); return; }

    Audio.play(out.draw ? 'drawn-game' : out.winner === 0 ? 'win' : 'lose');
    var scoreLine = st.players.map(function (p, i) { return p.name + ' ' + st.scores[i]; }).join(' · ');
    announce((out.draw ? 'A tie. ' : out.winner === 0 ? 'Victory! ' : 'Defeat. ') + scoreLine);

    var breakdown = Rules.scoreBreakdown(st, 0, sess.elapsedMs);
    var won = out.winner === 0;
    var newAchievements = [];

    // ---- progression (completed games only)
    var p = doc.progress, stt = p.stats;
    stt.rounds += 1;
    if (won) stt.wins += 1;
    stt.boxesClaimed += st.scores[0];
    if (bestChainGame > stt.bestChain) stt.bestChain = bestChainGame;
    stt.playMs += sess.elapsedMs;

    var stars = null;
    if (curCfg.kind === 'journey' && won) {
      var others = st.scores.filter(function (_, i) { return i !== 0; });
      var margin = st.scores[0] - Math.max.apply(null, others.concat([0]));
      stars = 1 +
        (margin >= (curCfg.starMargin || 1) ? 1 : 0) +
        (curCfg.par && sess.elapsedMs <= curCfg.par.timeSec * 1000 ? 1 : 0);
      p.journeyStars[curCfg.id] = Math.max(p.journeyStars[curCfg.id] || 0, stars);
      p.journeyBest[curCfg.id] = Math.max(p.journeyBest[curCfg.id] || 0, breakdown.total);
    } else if (curCfg.kind === 'challenge' && won) {
      p.challengeBest[curCfg.id] = Math.max(p.challengeBest[curCfg.id] || 0, breakdown.total);
    } else if (curCfg.kind === 'daily') {
      var date = curCfg.date || Content.utcDateString(serverNow());
      p.dailiesDone[date] = Math.max(p.dailiesDone[date] || 0, breakdown.total);
      var y = new Date(new Date(date + 'T00:00:00Z').getTime() - 86400000);
      var yStr = Content.utcDateString(y.getTime());
      stt.dailyStreak = p.dailiesDone[yStr] != null ? (stt.lastDaily === date ? stt.dailyStreak : stt.dailyStreak + 1) : 1;
      stt.lastDaily = date;
    }

    // ---- achievements (idempotent)
    function unlock(key) {
      if (p.achievements[key]) return;
      p.achievements[key] = serverNow();
      var meta = Store.ACHIEVEMENTS.filter(function (a) { return a.key === key; })[0];
      if (meta) {
        newAchievements.push(meta);
        showToast('🏅 ' + meta.name);
        Audio.play('star');
      }
    }
    if (stt.boxesClaimed > 0) unlock('first-box');
    if (stt.wins > 0) unlock('first-win');
    if (stt.bestChain >= 3) unlock('chain-3');
    if (Object.keys(p.journeyStars).filter(function (k) { return p.journeyStars[k] > 0; }).length >= 10) unlock('journey-10');
    if (stt.dailyStreak >= 3 || Object.keys(p.dailiesDone).length >= 3) unlock('daily-3');
    if (stt.boxesClaimed >= 500) unlock('boxes-500');

    // ---- ranked leaderboard
    if (curCfg.ranked && !sess.assists) {
      var sid = randomHex(8);
      var entry = {
        name: doc.profileName || 'Guest',
        score: breakdown.total,
        board: curCfg.id,
        seed: curCfg.seed,
        ruleset: curCfg.kind,
        contentVersion: curCfg.version,
        assists: sess.assists,
        durationMs: sess.elapsedMs,
        invalid: sess.invalid[0] || 0,
        sessionId: sid,
        at: Date.now()
      };
      var boards = Store.loadBoards();
      boards.entries = Store.sortEntries(boards.entries.concat([entry])).slice(0, 100);
      Store.saveBoards(boards);
      postScore(entry, sid);
    }

    saveDoc();
    track('round-end');

    lastResultsCfg = { cfg: curCfg, lesson: null };
    var nextStage = curCfg.kind === 'journey' ? Content.JOURNEY[curCfg.index + 1] : null;
    var headline = out.reason === Rules.TERMINAL.TIME ? 'Time!' :
      out.draw ? 'A tie!' : won ? 'Victory!' : 'Defeat';
    appState = 'results';
    showScreen('results', {
      headline: headline,
      sub: scoreLine,
      won: won,
      breakdown: breakdown,
      stars: curCfg.kind === 'journey' ? (stars || p.journeyStars[curCfg.id] || 0) : null,
      newAchievements: newAchievements,
      canNext: !!(nextStage && won)
    });
    appState = 'progression';
  }

  function randomHex(n) {
    var s = '';
    var buf = new Uint8Array(n);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(buf) : buf.forEach(function (_, i) { buf[i] = Math.floor(Math.random() * 256); });
    for (var i = 0; i < n; i++) s += buf[i].toString(16).padStart(2, '0');
    return s;
  }

  function postScore(entry, sid) {
    try {
      fetch('/api/v1/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: entry.name, board: entry.board, cfg: sess.cfg, commands: sess.log,
          assists: sess.assists, durationMs: sess.elapsedMs,
          invalid: sess.invalid[0] || 0, sessionId: sid
        })
      }).catch(function () { /* offline play is normal */ });
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- hosted play

  function appendHostedCard(body) {
    var grid = body.querySelector('.card-grid');
    if (!grid) return;
    var card = el('button', { class: 'card', 'aria-label': 'Hosted play on the server' }, [
      el('span', { class: 'card-title', text: 'Hosted' }),
      el('span', { class: 'card-sub', text: 'Server-authoritative sheet' })
    ]);
    card.addEventListener('click', function () { showScreen('hosted'); });
    grid.appendChild(card);
  }

  function buildHostedForm(body) {
    body.innerHTML = '';
    var ai = 'medium';
    var form = el('div', { class: 'setup-form' });
    form.appendChild(el('h3', { text: 'Server rival' }));
    var row = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Rival difficulty' });
    Content.AI_LEVELS.forEach(function (lv, i) {
      var b = el('button', {
        class: 'seg-btn' + (i === 1 ? ' on' : ''), role: 'radio',
        'aria-checked': i === 1 ? 'true' : 'false',
        text: Content.AI_NAMES[lv] + ' · ' + lv
      });
      b.addEventListener('click', function () {
        ai = lv;
        row.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
        b.classList.add('on'); b.setAttribute('aria-checked', 'true');
      });
      row.appendChild(b);
    });
    form.appendChild(row);
    form.appendChild(el('p', { class: 'dim', text: 'A 4×4 sheet run by the server. Rejoin works after a reload.' }));
    var start = el('button', { class: 'btn primary big', text: 'Start hosted sheet' });
    start.addEventListener('click', function () { hostedStart(ai); });
    form.appendChild(start);
    body.appendChild(form);
  }

  function hostedStart(aiLevel) {
    fetch('/api/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: 4, cols: 4, seed: (Math.random() * 0xffffffff) >>> 0, aiLevel: aiLevel })
    }).then(function (r) {
      if (!r.ok) throw new Error('bad status');
      return r.json();
    }).then(function (data) {
      var cfg = {
        id: 'hosted-' + data.sessionId, version: Content.CONTENT_VERSION, kind: 'hosted',
        name: 'Hosted sheet', seed: data.seed || 1, rows: 4, cols: 4,
        players: [{ name: 'You', type: 'human' }, { name: Content.AI_NAMES[aiLevel] || 'Rival', type: 'ai', ai: aiLevel }],
        mechanics: { undo: false, hint: false }, ranked: false,
        goalText: 'Hosted sheet — the server is the referee.'
      };
      closeScreen();
      startGame(cfg);
      hosted = { id: data.sessionId };
      if (data.state) mergeHostedState(data);
      saveHostedMarker();
      announce('Hosted sheet started.');
    }).catch(function () {
      track('error');
      showToast('Server unavailable — hosted play needs the server');
    });
  }

  function saveHostedMarker() {
    try {
      sessionStorage.setItem('bl.hosted', JSON.stringify({ id: hosted.id, lastTurn: sess ? sess.state.turn : 0 }));
    } catch (e) {}
  }

  function mergeHostedState(data) {
    if (data.state && data.state.v === Rules.STATE_VERSION) {
      data.state.events = data.state.events || [];
      sess.state = data.state;
    }
    var events = data.events || (sess.state.events || []);
    if (events.length) {
      handleEvents(events);
      rCall('animateEvents', events);
    }
    rCall('syncState', sess.state);
    rCall('setTurn', sess.state.current);
    syncMirror();
    updateHUD();
  }

  function hostedMove(cmd) {
    fetch('/api/v1/sessions/' + hosted.id + '/moves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmdId: cmd.id, dir: cmd.dir, r: cmd.r, c: cmd.c })
    }).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw Object.assign(new Error('bad status'), { body: body });
        return body;
      });
    }).then(function (data) {
      if (!sess || !hosted) return;
      if (data.ok === false) {
        Audio.play('invalid');
        var msg = invalidText(data.reason);
        showToast(msg); announce(msg);
        return;
      }
      if (data.duplicate) return; // idempotent retry — already animated
      mergeHostedState(data);
      saveHostedMarker();
      if (sess.state.over) finishGame();
      else scheduleAiIfNeeded(); // no-op for hosted AI (server drives), harmless
    }).catch(function (err) {
      track('error');
      var reason = err && err.body && err.body.error;
      if (reason) { var m = invalidText(reason); showToast(m); announce(m); }
      else showToast('Connection lost — your move was not sent. Try again.');
    });
  }

  function hostedResign(silent) {
    if (!hosted) return;
    var id = hosted.id;
    try { sessionStorage.removeItem('bl.hosted'); } catch (e) {}
    hosted = null;
    fetch('/api/v1/sessions/' + id + '/resign', { method: 'POST' }).catch(function () {});
    if (!silent) { closeScreen(); teardownGame(); goTitle(); }
  }

  function checkHostedRejoin() {
    var marker = null;
    try { marker = JSON.parse(sessionStorage.getItem('bl.hosted') || 'null'); } catch (e) {}
    if (!marker || !marker.id) return;
    fetch('/api/v1/sessions/' + marker.id).then(function (r) {
      if (!r.ok) throw new Error('gone');
      return r.json();
    }).then(function (data) {
      if (!data || !data.state || data.state.over) {
        try { sessionStorage.removeItem('bl.hosted'); } catch (e) {}
        return;
      }
      var away = data.state.turn - (marker.lastTurn || 0);
      showToast('Rejoin hosted sheet?' + (away > 0 ? ' While you were away: ' + away + ' moves, score ' +
        data.state.scores.join('–') + '.' : ''), 'Rejoin', function () {
        var cfg = {
          id: 'hosted-' + marker.id, version: Content.CONTENT_VERSION, kind: 'hosted',
          name: 'Hosted sheet', seed: 1, rows: data.state.rows, cols: data.state.cols,
          players: [{ name: 'You', type: 'human' }, { name: 'Rival', type: 'ai', ai: 'medium' }],
          mechanics: { undo: false, hint: false }, ranked: false,
          goalText: 'Hosted sheet — the server is the referee.'
        };
        startGame(cfg);
        hosted = { id: marker.id };
        mergeHostedState(data);
        saveHostedMarker();
        if (away > 0) showToast('While you were away: ' + away + ' moves played. Score ' + data.state.scores.join('–') + '.');
      });
    }).catch(function () { /* server gone; local play unaffected */ });
  }

  // ---------------------------------------------------------------- resize

  window.addEventListener('resize', function () { rCall('resize'); });
  window.addEventListener('orientationchange', function () { rCall('resize'); });

  // ---------------------------------------------------------------- audio boot

  var audioArmed = false;
  function armAudio() {
    if (audioArmed) return;
    audioArmed = true;
    Audio.start({ settings: doc.settings });
    Audio.applySettings(doc.settings);
    Audio.setCaptions(doc.settings.captions, showCaption);
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, armAudio, { once: false, passive: true });
  });

  // ---------------------------------------------------------------- boot

  function boot() {
    applyBodyClasses();
    buildShell($('game-root'));
    wireHudButtons();
    initRenderer();
    syncServerClock();
    goTitle();
    checkHostedRejoin();
  }

  boot();
})();
