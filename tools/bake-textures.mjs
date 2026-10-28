// Bakes the browser build's procedural canvas textures (src/render-gfx.js
// makeTextures; the painters below are unchanged but for tex(), which returns
// the canvas) into package images, run once in Chrome on the GPU
// (~/games/tools/gpu-chrome.mjs): the engine loads them with TextureLoader
// instead of painting ~1,700 canvas paths and 150 radial gradients at start
// (slow in the native interpreter). The browser build drew each texture at
// the preset's scale k (1 Balanced and High, 2 Ultra; Low drew none); skin
// and dot were always k = 1. Writes assets/textures/<name>-<k>.png.
// Run: node tools/bake-textures.mjs (offline; commit the PNGs).
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function painters() {
  // ---------------------------------------------------------------- seeded noise
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Texture scale from the preset's budget (makeTextures): every texture is authored at w×h and drawn
  // into a canvas of w·k × h·k, so the look is the same at every size.
  let texScale = 1;
  function canvas2d(w, h, k = texScale) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const g = c.getContext('2d');
    g.scale(c.width / w, c.height / h);
    return [c, g];
  }
  function tex(c) { return c; }

  // ---------------------------------------------------------------- procedural textures
  /**
   * All textures for the detailed stall at the budget's scale `k` (0.5 Low … 2 Ultra). Deterministic
   * (fixed seeds); dispose via disposeTextures.
   */
  function makeTextures(k = 1) {
    texScale = k;
    const T = {};
    // Wood planks with grain streaks (table, posts, crate frame).
    {
      const [c, g] = canvas2d(256, 256);
      const r = rng(11);
      g.fillStyle = '#a06c40'; g.fillRect(0, 0, 256, 256);
      const planks = 4;
      for (let p = 0; p < planks; p++) {
        const y0 = (p * 256) / planks;
        const tint = 0.9 + r() * 0.2;
        g.fillStyle = `rgba(${Math.round(150 * tint)},${Math.round(100 * tint)},${Math.round(58 * tint)},0.55)`;
        g.fillRect(0, y0, 256, 256 / planks);
        for (let i = 0; i < 26; i++) {
          const y = y0 + r() * (256 / planks);
          g.strokeStyle = `rgba(70,40,20,${0.08 + r() * 0.18})`;
          g.lineWidth = 0.6 + r() * 1.4;
          g.beginPath();
          g.moveTo(0, y);
          for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 1.6 + (r() - 0.5));
          g.stroke();
        }
        g.fillStyle = 'rgba(40,22,10,0.55)';
        g.fillRect(0, y0, 256, 2);
      }
      T.wood = tex(c, { repeat: [1, 1] });
    }
    // Striped awning cloth and a scalloped valance (alpha-tested edge).
    {
      const [c, g] = canvas2d(256, 64);
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#f4e8cc' : '#cf4a3c';
        g.fillRect(i * 32, 0, 32, 64);
      }
      T.awning = tex(c, { repeat: [3, 1] });
      const [c2, g2] = canvas2d(256, 64);
      g2.drawImage(c, 0, 0, 256, 64);
      g2.globalCompositeOperation = 'destination-in';
      g2.beginPath();
      g2.moveTo(0, 0); g2.lineTo(256, 0); g2.lineTo(256, 40);
      for (let i = 7; i >= 0; i--) g2.arc(i * 32 + 16, 40, 16, 0, Math.PI, false);
      g2.closePath(); g2.fill();
      T.valance = tex(c2, { repeat: [3, 1] });
    }
    // Cream canvas back cloth with a soft weave.
    {
      const [c, g] = canvas2d(128, 128);
      const r = rng(23);
      g.fillStyle = '#ece2c8'; g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 128; i += 2) {
        g.fillStyle = `rgba(120,100,70,${0.03 + r() * 0.04})`; g.fillRect(0, i, 128, 1);
        g.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.04})`; g.fillRect(i, 0, 1, 128);
      }
      T.cloth = tex(c, { repeat: [6, 6] });
    }
    // Grass: speckled greens.
    {
      const [c, g] = canvas2d(128, 128);
      const r = rng(37);
      g.fillStyle = '#76a257'; g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 1400; i++) {
        const v = r();
        g.fillStyle = v < 0.5 ? `rgba(60,110,40,${0.25 + r() * 0.3})` : `rgba(170,200,110,${0.15 + r() * 0.25})`;
        g.fillRect(r() * 128, r() * 128, 1 + r() * 2, 1 + r() * 3);
      }
      T.grass = tex(c, { repeat: [40, 40] });
    }
    // Fruit skin micro-relief (bump + roughness), grayscale, linear.
    {
      const [c, g] = canvas2d(128, 64, 1);
      const r = rng(53);
      g.fillStyle = '#808080'; g.fillRect(0, 0, 128, 64);
      for (let i = 0; i < 900; i++) {
        const v = Math.round(90 + r() * 90);
        g.fillStyle = `rgba(${v},${v},${v},0.5)`;
        g.beginPath(); g.arc(r() * 128, r() * 64, 0.6 + r() * 1.2, 0, Math.PI * 2); g.fill();
      }
      T.skin = tex(c, { srgb: false });
    }
    // Sky gradient with painted soft clouds (screen-space background; scrolls when animated).
    {
      const [c, g] = canvas2d(512, 256);
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#5ea8e6');
      grad.addColorStop(0.55, '#a9d6f7');
      grad.addColorStop(1, '#e9f1e4');
      g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
      const r = rng(71);
      for (let k = 0; k < 7; k++) {
        const cx = r() * 512, cy = 30 + r() * 110, w = 40 + r() * 60;
        for (let j = 0; j < 7; j++) {
          const x = cx + (r() - 0.5) * w * 1.6, y = cy + (r() - 0.5) * w * 0.25, rad = w * (0.25 + r() * 0.3);
          for (const dx of [-512, 0, 512]) {
            const rg = g.createRadialGradient(x + dx, y, 0, x + dx, y, rad);
            rg.addColorStop(0, 'rgba(255,255,255,0.55)');
            rg.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = rg;
            g.beginPath(); g.ellipse(x + dx, y, rad, rad * 0.45, 0, 0, Math.PI * 2); g.fill();
          }
        }
      }
      T.sky = tex(c);
    }
    // Soft round sprite for particles and motes.
    {
      const [c, g] = canvas2d(64, 64, 1);
      const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      rg.addColorStop(0, 'rgba(255,255,255,1)');
      rg.addColorStop(0.4, 'rgba(255,255,255,0.8)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
      T.dot = tex(c);
    }
    return T;
  }
  return makeTextures;
}

const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, close } = await launchChrome(chromium);
try {
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  const out = await page.evaluate((src) => {
    const makeTextures = new Function('return (' + src + ')()')();
    const res = {};
    for (const k of [1, 2]) {
      const T = makeTextures(k);
      for (const [name, c] of Object.entries(T)) {
        if (k === 2 && (name === 'skin' || name === 'dot')) continue;
        res[name + '-' + k] = c.toDataURL('image/png');
      }
    }
    return res;
  }, painters.toString());
  mkdirSync(join(root, 'assets/textures'), { recursive: true });
  for (const [name, url] of Object.entries(out)) {
    writeFileSync(join(root, 'assets/textures', name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    console.log(name);
  }
} finally { await close(); }
