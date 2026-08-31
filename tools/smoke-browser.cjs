/* Headless Chrome CDP smoke test for Boxes & Lines. */
'use strict';
const CHROME_PORT = 9333;
const BASE = process.env.BASE || 'http://localhost:8139/';
const { spawn } = require('child_process');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + CHROME_PORT, '--user-data-dir=/tmp/bl-smoke-profile', 'about:blank'],
    { stdio: 'ignore' });
  try {
    let targets = null;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      try { targets = await (await fetch(`http://localhost:${CHROME_PORT}/json`)).json(); break; } catch (e) {}
    }
    if (!targets) throw new Error('chrome did not start');
    const page = targets.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let mid = 0; const pending = new Map(); const errors = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
        errors.push(m.params.args.map(a => a.value || a.description || '').join(' '));
    };
    function send(method, params) {
      return new Promise(res => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
    }
    async function evaljs(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      return r.result.result.value;
    }
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url: BASE });
    await sleep(2500);

    const out = {};
    out.title = await evaljs(`document.title`);
    out.titleScreenVisible = await evaljs(`!document.getElementById('screen-overlay').hidden && document.querySelectorAll('.card').length >= 5`);
    out.cards = await evaljs(`[...document.querySelectorAll('.card .card-title')].map(e=>e.textContent)`);

    // Click "Play" (first card) → journey stage 1 starts.
    await evaljs(`document.querySelector('.card.primary-card').click()`);
    await sleep(1500);
    out.gameStarted = await evaljs(`document.getElementById('screen-overlay').hidden`);
    out.objective = await evaljs(`document.getElementById('objective-text').textContent`);
    out.mirrorButtons = await evaljs(`document.querySelectorAll('#board-mirror .edge-btn:not([disabled])').length`);
    out.canvasPresent = await evaljs(`!!document.querySelector('#scene-host canvas')`);

    // Draw an edge via the mirror (human move), then let the AI reply.
    await evaljs(`document.querySelector('#board-mirror .edge-btn:not([disabled])').click()`);
    await sleep(1600);
    out.drawnEdges = await evaljs(`document.querySelectorAll('#board-mirror .edge-btn.drawn').length`);
    out.scoreStrip = await evaljs(`document.getElementById('score-strip').textContent.trim()`);
    out.turnIndicator = await evaljs(`document.getElementById('turn-indicator').textContent.trim()`);

    // Keyboard: arrows + Enter draw another line.
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await sleep(200);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(1600);
    out.drawnAfterKeyboard = await evaljs(`document.querySelectorAll('#board-mirror .edge-btn.drawn').length`);

    // Hint + undo buttons respond (journey allows hints, not undo).
    await evaljs(`document.getElementById('btn-hint').click()`);
    await sleep(300);
    out.hintHighlighted = await evaljs(`document.querySelectorAll('#board-mirror .edge-btn.hinted').length`);
    out.undoDisabled = await evaljs(`document.getElementById('btn-undo').disabled`);

    // Pause / resume.
    await evaljs(`document.getElementById('btn-pause').click()`);
    await sleep(300);
    out.pauseShown = await evaljs(`!document.getElementById('pause-overlay').hidden`);
    await evaljs(`document.getElementById('btn-resume').click()`);
    await sleep(300);
    out.resumedOk = await evaljs(`document.getElementById('pause-overlay').hidden`);

    // Leave → title, then open settings and toggle a setting.
    await evaljs(`document.getElementById('btn-pause').click()`); await sleep(200);
    await evaljs(`document.getElementById('btn-leave').click()`); await sleep(600);
    out.backAtTitle = await evaljs(`!document.getElementById('screen-overlay').hidden`);
    await evaljs(`[...document.querySelectorAll('.title-links .btn')].find(b=>b.textContent==='Settings').click()`);
    await sleep(400);
    out.settingsRows = await evaljs(`document.querySelectorAll('.setting-row').length`);
    await evaljs(`[...document.querySelectorAll('.setting-row input[type=checkbox]')].find(i=>i.getAttribute('aria-label')==='High contrast').click()`);
    await sleep(200);
    out.highContrastApplied = await evaljs(`document.body.classList.contains('high-contrast')`);
    out.savedToStorage = await evaljs(`JSON.parse(localStorage.getItem('boxesandlines.save.v1')).payload !== undefined`);

    // Hosted play through the real server.
    await evaljs(`document.getElementById('screen-back').click()`); await sleep(300);
    await evaljs(`[...document.querySelectorAll('.card')].find(c=>c.textContent.includes('Hosted')).click()`);
    await sleep(400);
    await evaljs(`document.querySelector('#screen-body .btn.primary').click()`);
    await sleep(1200);
    out.hostedStarted = await evaljs(`document.getElementById('screen-overlay').hidden && document.querySelectorAll('#board-mirror .edge-btn:not([disabled])').length > 0`);
    await evaljs(`document.querySelector('#board-mirror .edge-btn:not([disabled])').click()`);
    await sleep(2000);
    out.hostedDrawn = await evaljs(`document.querySelectorAll('#board-mirror .edge-btn.drawn').length`);
    out.hostedObjective = await evaljs(`document.getElementById('objective-text').textContent`);

    out.jsErrors = errors;
    console.log(JSON.stringify(out, null, 1));
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
  }
}
main().catch(e => { console.error('SMOKE FAILED:', e); process.exit(1); });
