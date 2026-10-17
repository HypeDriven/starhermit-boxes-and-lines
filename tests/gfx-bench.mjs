// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset through the real
// Settings screen, starts the largest Practice sheet and keeps drawing edges with the on-screen
// button board so folds, bursts, dust and the post chain all run.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

const title = (page, text) => page.waitForFunction((t) => document.getElementById('screen-title').textContent === t, text, { timeout: 20000 });

export async function setPreset(page, preset) {
  await title(page, 'Boxes & Lines');
  await page.locator('.title-links .btn', { hasText: 'Settings' }).click();
  await title(page, 'Settings');
  await page.locator('#gfx-preset').scrollIntoViewIfNeeded();
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.keyboard.press('Escape');
  await title(page, 'Boxes & Lines');
}

export async function start(page) {
  await page.locator('.card', { hasText: 'Practice' }).first().click();
  await title(page, 'Practice');
  await page.locator('#screen-body .seg-btn', { hasText: 'Master Sheet' }).click();
  await page.locator('#screen-body .btn.primary.big').click();
  await page.waitForFunction(() => document.getElementById('screen-overlay').hidden);
  // A move every 450 ms whenever it is the player's turn (the rival replies on its own).
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      if ((await page.textContent('#turn-indicator')).trim() === 'Your turn') {
        await page.locator('#board-mirror .edge-btn:not([disabled])').first().click({ timeout: 400 });
      }
    } catch { /* page closing or the rival moved first */ } finally { busy = false; }
  }, 450);
  page.once('close', () => clearInterval(timer));
  await page.waitForTimeout(800);
}
