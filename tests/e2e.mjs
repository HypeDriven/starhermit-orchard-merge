/**
 * Orchard Merge — end-to-end QA playthrough (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome via playwright-core:
 *   title → settings/help → journey stage 1 → countdown → hint-guided drops
 *   (Hint button → #aria-live column, aim slider, Drop button, Skip settle)
 *   until the results screen, plus pause/resume mid-run. Runs twice: desktop
 *   1280x800 and a fresh mobile 390x844 touch context (thumb-tray buttons +
 *   ArrowLeft/ArrowRight keys there, since the side rails are hidden below
 *   1024px).
 *
 * REGRESSION GUARD (mobile HUD): below 1024px the side rails are hidden, and
 * the HUD grid used to hand #topbar the 1fr row so it stretched over nearly
 * the whole stage (measured 378x706 at 390x844) and its pointer-events:auto
 * swallowed every touch on the playfield. The mobile pass now asserts that a
 * tap in the middle of the stage lands on the canvas, and aims with the
 * thumb-tray #tt-aim slider (the rail slider is hidden there).
 *
 * All actions go through on-screen controls. Game state is only *read*
 * (#aim-slider value, #aria-live hint text, #score-big, button disabled
 * states) for synchronization and aiming decisions. `force: true` clicks are
 * used for in-game buttons because software WebGL (swiftshader) renders each
 * frame in ~0.5s and Playwright's actionability stability checks would
 * otherwise take minutes; the click itself is still a real mouse event at
 * the element's position, and drop legality is gated by our own waits on the
 * Drop button's disabled state.
 *
 * This test embeds its own plain static server on an ephemeral port (no API
 * routes) and asserts a standalone load makes zero same-origin /api or /ws
 * requests.
 *
 * Run: npm run test:e2e
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, vp) => `/tmp/orchard-merge-e2e-${stage}-${vp}.png`;
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.ts': 'text/plain; charset=utf-8',
};

function serve() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      let p = path.normalize(decodeURIComponent(url.pathname));
      if (p === '/' || p === '\\') p = '/index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const step = async (name, fn) => {
  await fn();
  console.log(`ok - ${name}`);
};

const visible = (page, sel) => page.waitForSelector(`${sel}:not(.hidden)`, { timeout: 15000 });
// Drop is enabled only while phase === 'active' and the cooldown has drained.
const dropReady = (page) =>
  page.waitForFunction(() => {
    const b = document.getElementById('btn-drop');
    return b && !b.disabled && !document.getElementById('hud').classList.contains('hidden');
  }, null, { timeout: 15000, polling: 100 });
const resultsUp = (page) =>
  page.evaluate(() => !document.getElementById('scr-results').classList.contains('hidden'));
// Wait until another drop is legal or the run has ended (results screen).
const dropReadyOrOver = (page) =>
  page.waitForFunction(() => {
    if (!document.getElementById('scr-results').classList.contains('hidden')) return true;
    const b = document.getElementById('btn-drop');
    return b && !b.disabled && !document.getElementById('hud').classList.contains('hidden');
  }, null, { timeout: 20000, polling: 100 });

async function runPass(browser, vp, port) {
  const isMobile = vp === 'mobile';
  const context = await browser.newContext(
    isMobile
      ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
      : { viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  const ownApi = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.port === String(port) && /^\/(api|ws)(\/|$)/.test(u.pathname)) ownApi.push(`${r.method()} ${u.pathname}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !browserNoise.test(m.text())) errors.push(`console ${m.type()}: ${m.text()}`);
  });

  // One drop iteration, all through visible controls. Returns once per drop.
  const dropOnce = async (i) => {
    let target = 10; // center for the first (hint-less) drop
    if (i > 0) {
      await page.click(isMobile ? '#tt-hint' : '#btn-hint', { force: true });
      const msg = await page.textContent('#aria-live');
      const m = /position ([0-9.]+)/.exec(msg || '');
      if (m) target = parseFloat(m[1]);
    }
    if (isMobile) {
      // thumb-tray slider is the visible aim control below 1024px
      await page.locator('#tt-aim').fill(String(target));
      await page.click('#tt-drop', { force: true });
    } else {
      const slider = page.locator('#aim-slider');
      const box = await slider.boundingBox();
      const fx = Math.max(0.02, Math.min(0.98, (target - 1) / 18));
      await page.mouse.click(box.x + box.width * fx, box.y + box.height / 2);
      await page.click('#btn-drop', { force: true });
    }
    if (await resultsUp(page)) return;
    await page.click(isMobile ? '#tt-skip' : '#btn-skip', { force: true }); // fast-forward settling
  };

  try {
    await step(`[${vp}] load + title visible`, async () => {
      await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'load' });
      await visible(page, '#scr-title');
      await page.waitForSelector('#bt-play', { state: 'visible' });
      await page.screenshot({ path: SHOT('title', vp) });
    });

    await step(`[${vp}] graphics settings: presets, override, persistence`, async () => {
      const presetIs = (p) => page.waitForFunction((p) => document.getElementById('gl').dataset.gfxPreset === p, p, { timeout: 20000 });
      const summary = () => page.textContent('#gfx-summary');
      await page.click('#bt-settings');
      await visible(page, '#scr-settings');
      await page.locator('#gfx-section').scrollIntoViewIfNeeded();
      // Auto is the default and names the detected tier (software GL in headless Chrome → Low)
      if ((await page.inputValue('#set-quality')) !== 'auto') throw new Error('graphics preset should default to Auto');
      const autoLabel = await page.locator('#set-quality option[value="auto"]').textContent();
      if (!/^Auto \(detected: (Low|Balanced|High|Ultra)\)$/.test(autoLabel)) throw new Error(`auto label "${autoLabel}"`);
      const cats = await page.locator('#gfx-cats select[data-gfx-cat]').count();
      if (cats < 8) throw new Error(`expected graphics category selects, got ${cats}`);
      await page.selectOption('#set-quality', 'low');
      await presetIs('low');
      if (!/no shadows/.test(await summary())) throw new Error(`low summary: ${await summary()}`);
      await page.selectOption('#set-quality', 'high');
      await presetIs('high');
      if (!/bloom/.test(await summary())) throw new Error(`high summary lacks bloom: ${await summary()}`);
      const fromPreset = await page.locator('#gfx-bloom option[value="preset"]').textContent();
      if (fromPreset !== 'From preset (On)') throw new Error(`bloom preset label "${fromPreset}"`);
      // one override, applied live
      await page.selectOption('#gfx-bloom', 'off');
      await page.waitForFunction(() => !/bloom/.test(document.getElementById('gfx-summary').textContent));
      // Ultra renders cleanly, and choosing a preset clears overrides
      await page.selectOption('#set-quality', 'ultra');
      await presetIs('ultra');
      await page.waitForTimeout(1500);
      if ((await page.inputValue('#gfx-bloom')) !== 'preset') throw new Error('preset change did not clear the override');
      await page.selectOption('#set-quality', 'high');
      await page.selectOption('#gfx-bloom', 'off');
      await page.check('#gfx-fps');
      await page.waitForSelector('#fps-meter:not([hidden])', { state: 'attached' });
      await page.screenshot({ path: SHOT('graphics', vp) });
      // survives a reload
      await page.reload({ waitUntil: 'load' });
      await visible(page, '#scr-title');
      await presetIs('high');
      await page.click('#bt-settings');
      await visible(page, '#scr-settings');
      if ((await page.inputValue('#set-quality')) !== 'high') throw new Error('preset not persisted');
      if ((await page.inputValue('#gfx-bloom')) !== 'off') throw new Error('override not persisted');
      if (!(await page.isChecked('#gfx-fps'))) throw new Error('frame-rate toggle not persisted');
      // back to Low (cheap under software GL) for the playthrough
      await page.uncheck('#gfx-fps');
      await page.selectOption('#set-quality', 'low');
      await presetIs('low');
      if ((await page.inputValue('#gfx-bloom')) !== 'preset') throw new Error('override survived preset change');
      await page.click('#set-close');
      await visible(page, '#scr-title');
    });

    await step(`[${vp}] settings open/change/close`, async () => {
      await page.click('#bt-settings');
      await visible(page, '#scr-settings');
      await page.selectOption('#set-quality', 'low'); // cheaper render under swiftshader
      await page.selectOption('#set-palette', 'deuteranopia');
      await page.check('#set-rm');
      await page.screenshot({ path: SHOT('settings', vp) });
      await page.click('#set-close');
      await visible(page, '#scr-title');
    });

    await step(`[${vp}] help open/close`, async () => {
      await page.click('#bt-help');
      await visible(page, '#scr-help');
      await page.click('#help-close');
      await visible(page, '#scr-title');
    });

    await step(`[${vp}] journey setup + stage 1`, async () => {
      await page.click('#bt-journey');
      await visible(page, '#scr-setup');
      const stages = await page.locator('#setup-body .grid button').count();
      if (stages !== 40) throw new Error(`expected 40 journey stages, got ${stages}`);
      await page.screenshot({ path: SHOT('journey', vp) });
      await page.locator('#setup-body .grid button').first().click();
    });

    await step(`[${vp}] countdown → active play`, async () => {
      await page.waitForSelector('#countdown:not(.hidden)');
      await page.waitForSelector('#hud:not(.hidden)');
      await dropReady(page);
      if (isMobile) {
        if (await page.locator('#thumbtray').isHidden()) throw new Error('thumb tray hidden on mobile');
        if (await page.locator('#tt-aim').isHidden()) throw new Error('thumb-tray aim slider hidden on mobile');
        // the playfield must accept taps: nothing in the HUD may cover it
        const hit = await page.evaluate(() => {
          const r = document.getElementById('stage').getBoundingClientRect();
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return el ? el.id || el.tagName : 'none';
        });
        if (hit !== 'gl') throw new Error(`stage centre not tappable on mobile, hit "${hit}"`);
      } else if (await page.locator('#rail-right').isHidden()) {
        throw new Error('right rail hidden on desktop');
      }
      await page.screenshot({ path: SHOT('play-start', vp) });
    });

    await step(`[${vp}] pause/resume mid-run`, async () => {
      await dropReadyOrOver(page);
      await dropOnce(0);
      await page.click(isMobile ? '#tt-pause' : '#btn-pause', { force: true });
      await visible(page, '#scr-pause');
      await page.screenshot({ path: SHOT('pause', vp) });
      await page.click('#bp-resume');
      await dropReadyOrOver(page);
    });

    await step(`[${vp}] play journey stage 1 to results`, async () => {
      let drops = 1; // one drop already made above
      for (let i = 1; i < 60; i++) {
        await dropReadyOrOver(page);
        if (await resultsUp(page)) break;
        await dropOnce(i);
        drops++;
        if (drops % 10 === 0) {
          console.log(`  ... ${drops} drops, score ${await page.textContent('#score-big')}, warn ${await page.locator('#warn-banner').isVisible()}`);
        }
      }
      if (!(await resultsUp(page))) throw new Error(`no results after ${drops} drops`);
      await visible(page, '#scr-results');
      const headline = (await page.textContent('#res-h')).trim();
      const breakdown = await page.textContent('#res-breakdown');
      const rows = await page.locator('#res-breakdown table tr').count();
      if (rows < 5) throw new Error(`expected breakdown rows, got ${rows}`);
      console.log(`  drops: ${drops}, headline: "${headline}", total: ${/Total<\/strong><\/td><td><strong>(\d+)/.exec(await page.innerHTML('#res-breakdown'))?.[1] ?? '?'}`);
      if (!breakdown.includes('Merge score')) throw new Error('breakdown missing');
      await page.screenshot({ path: SHOT('results', vp) });
    });

    await step(`[${vp}] back to title`, async () => {
      await page.click('#br-title');
      await visible(page, '#scr-title');
      await page.screenshot({ path: SHOT('back-to-title', vp) });
    });
  } finally {
    await context.close();
  }

  if (ownApi.length) errors.push(`standalone made own-server requests: ${ownApi.join(', ')}`);
  if (errors.length) {
    throw new Error(`[${vp}] page errors:\n${errors.join('\n')}`);
  }
}

const server = await serve();
const PORT = server.address().port;
let browser = null;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  await runPass(browser, 'desktop', PORT);
  await runPass(browser, 'mobile', PORT);
  console.log('\nE2E PASS — orchard-merge playable end-to-end on desktop + mobile, no page errors');
} catch (e) {
  console.error(`\nE2E FAIL: ${e.message || e}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
