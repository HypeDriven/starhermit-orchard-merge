// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts a Practice run and keeps dropping fruit with the visible aim and Drop controls (the rail on
// desktop, the thumb tray on phones), sweeping the aim across the crate so fruit pile up, merge,
// burst and bloom; a finished run goes to Retry.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForSelector('#scr-title:not(.hidden)', { timeout: 30000 });
  await page.click('#bt-settings');
  await page.waitForSelector('#scr-settings:not(.hidden)');
  await page.locator('#gfx-section').scrollIntoViewIfNeeded();
  await page.selectOption('#set-quality', preset);
  await page.waitForFunction((p) => document.getElementById('gl').dataset.gfxPreset === p, preset, { timeout: 20000 });
  await page.click('#set-close');
  await page.waitForSelector('#scr-title:not(.hidden)');
}

const AIMS = [3, 17, 7, 13, 10, 5, 15, 9, 11, 2, 18];

export async function start(page, { mobile } = {}) {
  await page.click('#bt-practice');
  await page.waitForSelector('#scr-setup:not(.hidden)');
  await page.click('#setup-start');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 20000 });
  let open = true, i = 0;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try {
        if (await page.locator('#scr-results:not(.hidden)').count()) {
          await page.click('#br-retry', { timeout: 3000 });
          await page.waitForSelector('#hud:not(.hidden)', { timeout: 20000 });
        } else if (await page.evaluate(() => { const b = document.getElementById('btn-drop'); return b && !b.disabled; })) {
          const target = AIMS[i++ % AIMS.length];
          if (mobile) {
            await page.locator('#tt-aim').fill(String(target));
            await page.click('#tt-drop', { force: true });
          } else {
            const box = await page.locator('#aim-slider').boundingBox();
            await page.mouse.click(box.x + box.width * ((target - 1) / 18), box.y + box.height / 2);
            await page.click('#btn-drop', { force: true });
          }
        }
      } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
      await page.waitForTimeout(500).catch(() => {});
    }
  })();
  await page.waitForTimeout(1500);
}
