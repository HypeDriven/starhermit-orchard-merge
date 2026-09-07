'use strict';

/*
 * API + static-serving checks for server.js. Boots the real server on an
 * ephemeral port and drives it over HTTP. Score submissions use a replay built
 * with the rules engine the same way the client builds one (tick-indexed
 * commands, continuous simulation), so this also pins the client/server
 * replay contract.
 */

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const R = require('../src/rules.js');

const ROOT = path.resolve(__dirname, '..');

function startServer(dataDir) {
  return new Promise((resolve, reject) => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(port)],
      { cwd: ROOT, env: { ...process.env, OM_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
    const fail = setTimeout(() => reject(new Error('server did not start')), 8000);
    child.stdout.on('data', d => {
      if (String(d).includes('listening')) { clearTimeout(fail); resolve({ child, port }); }
    });
    child.on('error', e => { clearTimeout(fail); reject(e); });
  });
}

async function api(port, pathname, init) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body (static/errors) */ }
  return { status: res.status, text, json };
}

// A run the client could actually have produced: continuous ticks, drops
// recorded with the tick they landed on.
function buildReplay(seed, difficulty, drops) {
  const s = R.newGame(seed, { difficulty });
  const commands = [];
  for (let i = 0; i < drops; i++) {
    while (!R.legalActions(s).drop && s.status === 'active') R.step(s);
    if (s.status !== 'active') break;
    for (let k = 0; k < 20 + i * 7; k++) R.step(s);
    if (s.status !== 'active') break;
    const x = R.quantizeX(3 + (i * 3.3) % 13);
    if (!R.applyCommand(s, { kind: 'drop', x })) break;
    commands.push({ kind: 'drop', x, tick: s.tick });
  }
  for (let i = 0; i < 300 && s.status === 'active'; i++) R.step(s);
  return { seed, difficulty, commands, finalTick: s.tick, finalHash: R.stateHash(s), score: s.score };
}

test('server API and static serving', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'orchard-review-'));
  const { child, port } = await startServer(dataDir);
  t.after(() => {
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await t.test('serves index.html from the root path', async () => {
    const r = await api(port, '/');
    assert.strictEqual(r.status, 200);
    assert.ok(r.text.includes('Orchard Merge'));
  });

  await t.test('rejects traversal outside the distribution root', async () => {
    // %2e%2e survives URL normalization and is decoded by the server
    for (const p of ['/%2e%2e/agents.md', `/%2e%2e/${path.basename(ROOT)}-escape/x.txt`]) {
      const r = await api(port, p);
      assert.notStrictEqual(r.status, 200, `${p} must not be served`);
      assert.ok(r.status === 403 || r.status === 404, `expected 403/404 for ${p}, got ${r.status}`);
    }
  });

  await t.test('malformed path returns 400 and the server stays available', async () => {
    assert.strictEqual((await api(port, '/%ZZ')).status, 400);
    assert.strictEqual((await api(port, '/')).status, 200);
  });

  await t.test('daily endpoint returns a stable seed for the UTC date', async () => {
    const r = await api(port, '/api/v1/daily');
    assert.strictEqual(r.status, 200);
    const day = new Date().toISOString().slice(0, 10);
    assert.strictEqual(r.json.date, day);
    assert.strictEqual(r.json.seed, R.hashStr('orchard-daily-' + day));
    assert.strictEqual(r.json.rulesVersion, R.RULES_VERSION);
  });

  await t.test('unknown api routes 404 as json', async () => {
    const r = await api(port, '/api/v1/nope');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.json.error, 'not-found');
  });

  const replay = buildReplay(4242, 'normal', 6);

  await t.test('accepts a faithful replay and ranks it', async () => {
    const r = await api(port, '/api/v1/scores', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'tester', scope: 'score-chase', ...replay }),
    });
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.json.ok, true);
    assert.strictEqual(r.json.entry.score, replay.score);
    assert.ok(r.json.rank >= 1);
  });

  await t.test('rejects an inflated score', async () => {
    const r = await api(port, '/api/v1/scores', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'score-chase', ...replay, score: replay.score + 5000 }),
    });
    assert.strictEqual(r.status, 422);
    assert.ok(['score-mismatch', 'hash-mismatch'].includes(r.json.error), r.text);
  });

  await t.test('rejects a tampered final hash', async () => {
    const r = await api(port, '/api/v1/scores', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'score-chase', ...replay, finalHash: (replay.finalHash ^ 1) >>> 0 }),
    });
    assert.strictEqual(r.status, 422);
    assert.strictEqual(r.json.error, 'hash-mismatch');
  });

  await t.test('rejects a daily submission with a stale seed', async () => {
    const r = await api(port, '/api/v1/scores', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'daily', ...replay }),
    });
    assert.strictEqual(r.status, 422);
    assert.strictEqual(r.json.error, 'stale-or-wrong-daily-seed');
  });

  await t.test('rejects malformed bodies with 400', async () => {
    const r = await api(port, '/api/v1/scores', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json',
    });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.error, 'bad-json');
  });

  await t.test('lists submitted score-chase entries', async () => {
    const r = await api(port, '/api/v1/scores?scope=score-chase');
    assert.strictEqual(r.status, 200);
    assert.ok(r.json.entries.some(e => e.score === replay.score));
  });
});
