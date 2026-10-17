// Platform adapter over the shared StarHermit SDK: launch token, profile
// name, game:<slug> cloud-save round-trip, settings KV, controls, and no
// network at all when standalone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Load the shipped SDK copy as a classic script (the package is ESM).
const sdkModule = { exports: {} };
new Function('module', 'self', fs.readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8'))(sdkModule, globalThis);
const SDK = sdkModule.exports;
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = 'h.' + b64u({ sub: 'user-123456', game_scope: 'om-slug', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.s';

// SDK renewal timers must not keep the test process alive.
const unrefTimeout = (f, ms) => { const t = setTimeout(f, ms); t.unref(); return t; };

function fakeServer() {
  const calls = [], saves = {}, kv = {}, etags = {};
  let version = 0;
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push([method, url]);
    const r = (status, body) => new Response(body == null ? null : body, { status });
    if (url.includes('/cloud-saves/')) {
      // Conditional writes like the platform: If-Match / If-None-Match after a
      // load, 412 with the current etag when stale, { etag } on success.
      const tail = decodeURIComponent(url.split('/cloud-saves/')[1]);
      const key = tail.replace(/\/info$/, '');
      const h = new Headers(init.headers || {});
      if (tail.endsWith('/info')) return r(200, JSON.stringify(saves[key] ? { exists: true, etag: etags[key] } : { exists: false }));
      if (method === 'PUT') {
        if ((h.get('If-Match') && h.get('If-Match') !== etags[key]) || (h.get('If-None-Match') === '*' && saves[key])) return r(412, JSON.stringify({ etag: etags[key] || null }));
        saves[key] = Buffer.from(JSON.parse(init.body).dataBase64, 'base64');
        etags[key] = '"v' + (++version) + '"';
        return r(200, JSON.stringify({ etag: etags[key] }));
      }
      return saves[key] ? r(200, saves[key]) : r(404);
    }
    if (url.endsWith('/profile')) return r(200, JSON.stringify({ username: 'u', nickname: 'Tess' }));
    if (url.endsWith('/settings') && method === 'PATCH') { Object.assign(kv, JSON.parse(init.body).settings); return r(200, '{}'); }
    if (url.endsWith('/settings')) return r(200, JSON.stringify({ settings: kv }));
    if (url.endsWith('/controls')) return r(200, JSON.stringify({ actions: [{ action: 'hint', codes: ['KeyJ'] }] }));
    return r(404);
  };
  return { calls, saves, kv, etags, fetch, bump(key) { etags[key] = '"v' + (++version) + '"'; } };
}

function install(hash, srv, hostname = 'om-slug.starhermit.com') {
  const win = {
    location: { hash, search: '', pathname: '/', hostname, origin: 'https://' + hostname, href: 'https://' + hostname + '/' },
    history: { replaceState() {} },
    addEventListener() {},
  };
  win.StarHermit = SDK.create({ window: win, fetch: srv.fetch, setTimeout: unrefTimeout });
  globalThis.window = win;
  globalThis.location = win.location;
  globalThis.fetch = srv.fetch; // any direct request is counted too
  return win;
}

test('hosted: token, profile, cloud save game:<slug>, settings, controls', async () => {
  const srv = fakeServer();
  install('#game_token=' + token, srv, 'om-slug.starhermit.com');
  const { platform: P } = await import('../src/platform.js?hosted');
  assert.equal(P.init(), true);
  assert.equal(P.sub, 'user-123456');
  assert.equal(P.slug, 'om-slug');
  await P.fetchProfile();
  assert.equal(P.nickname, 'Tess');

  let adopted = null;
  P.hooks.buildSaveDoc = () => ({ version: 1, save: { settings: { mute: false }, journey: { unlocked: 4 } } });
  P.hooks.adoptRemote = (doc) => { adopted = doc; };
  await P.flushCloud();
  assert.deepEqual(Object.keys(srv.saves), []);   // nothing is pushed before the start-up load
  await P.loadCloud();                             // empty slot: seeded from the local doc
  assert.deepEqual(Object.keys(srv.saves), ['game:om-slug']);
  await P.loadCloud();
  assert.deepEqual(adopted.save.journey, { unlocked: 4 });

  P.patchSettings({ mute: true });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(srv.kv.mute, true);
  assert.deepEqual(await P.getSettings(), { mute: true });

  assert.deepEqual(await P.loadBindings({ hint: ['KeyH'], undo: ['KeyU'] }), { hint: ['KeyJ'], undo: ['KeyU'] });
  assert.ok(P.inviteLink().endsWith('/game-invite/user-123456/om-slug'));
  assert.equal(P.canSignIn(), false);
  await P.fetchTime();
  assert.ok(!srv.calls.some(([, u]) => /\/time|\/scores/.test(u)));
});

test('standalone: no token means no platform fetch at all', async () => {
  const srv = fakeServer();
  install('', srv, 'localhost');
  const { platform: P } = await import('../src/platform.js?standalone');
  assert.equal(P.init(), false);
  await P.fetchProfile();
  P.hooks.buildSaveDoc = () => ({ save: { settings: {} } });
  P.scheduleCloudPush();
  await P.flushCloud();
  await P.loadCloud();
  P.patchSettings({ mute: true });
  assert.equal(await P.getSettings(), null);
  assert.deepEqual(await P.loadBindings({ hint: ['KeyH'] }), { hint: ['KeyH'] });
  assert.equal(P.inviteLink(), null);
  assert.equal(P.canSignIn(), false);
  await P.fetchTime();
  assert.equal(await P.fetchLeaderboard(), null);
  assert.deepEqual(await P.submitScore(500), { posted: false, rank: null });
  assert.equal(srv.calls.length, 0);
});

test('sign-in is offered on a StarHermit UUID host without a token', async () => {
  const srv = fakeServer();
  install('', srv, '0b9d6f2e-3c4a-4e5b-9a7c-1d2e3f405162.starhermit.com');
  const { platform: P } = await import('../src/platform.js?uuid');
  P.init();
  assert.equal(P.canSignIn(), true);
});

test('cloud-save conflict: a write that lost to another device re-reads, merges and saves again', async () => {
  const srv = fakeServer();
  const win = install('#game_token=' + token, srv, 'om-slug.starhermit.com');
  const { platform: P } = await import('../src/platform.js?conflict');
  const { mergeSaves } = await import('../src/save-merge.js');
  P.init();
  let local = { settings: { mute: false }, journey: { unlocked: 3, cleared: { 0: 300, 1: 200 } }, daily: {}, leaderboard: [], achievements: {}, lifetime: 500, resume: null };
  P.hooks.buildSaveDoc = () => ({ version: 1, save: local });
  P.hooks.adoptRemote = (doc) => { local = mergeSaves(doc.save, local); };
  await P.loadCloud();                             // empty slot: seeded; writes are conditional from now on
  // Another device saves further progress.
  const other = { settings: { mute: true }, journey: { unlocked: 6, cleared: { 0: 900, 4: 700 } }, daily: { '2026-10-16': { score: 1200, hash: 1 } },
    leaderboard: [{ mode: 'daily', score: 1200, hash: 1, date: '2026-10-16T00:00:00.000Z' }], achievements: { 'first-completion': '2026-10-01' }, lifetime: 4000, resume: null };
  srv.saves['game:om-slug'] = Buffer.from(await win.StarHermit._zip('save.json', new TextEncoder().encode(JSON.stringify({ version: 1, save: other }))));
  srv.bump('game:om-slug');
  local = { ...local, lifetime: 800, resume: { mode: 'practice' } };
  P.scheduleCloudPush();
  await P.flushCloud();                            // 412 → saveconflict → resolveConflict()
  for (let i = 0; i < 50 && !(local.lifetime === 4000 && P.syncState === 'synced'); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(P.syncState, 'synced');
  const stored = JSON.parse(new TextDecoder().decode(await win.StarHermit._unzip(srv.saves['game:om-slug']))).save;
  assert.deepEqual(stored.journey, { unlocked: 6, cleared: { 0: 900, 1: 200, 4: 700 } });
  assert.equal(stored.lifetime, 4000);
  assert.equal(stored.daily['2026-10-16'].score, 1200);
  assert.ok(stored.achievements['first-completion']);
  assert.deepEqual(stored.resume, { mode: 'practice' });   // this device's run in progress
  assert.equal(stored.settings.mute, false);              // this device's settings
});

test('mergeSaves keeps the better result of each side', async () => {
  const { mergeSaves } = await import('../src/save-merge.js');
  const a = { settings: { tutorialDone: true }, journey: { unlocked: 5, cleared: { 1: 100 } }, daily: { d: { score: 50 } },
    leaderboard: [{ mode: 'daily', score: 10, hash: 1, date: 'x' }], achievements: { a: '2026-01-02' }, lifetime: 10, resume: { r: 1 } };
  const b = { settings: { tutorialDone: false, mute: true }, journey: { unlocked: 2, cleared: { 1: 300, 2: 5 } }, daily: { d: { score: 20 }, e: { score: 1 } },
    leaderboard: [{ mode: 'daily', score: 10, hash: 1, date: 'x' }, { mode: 'journey', score: 99, hash: 2, date: 'y' }], achievements: { a: '2026-01-01', b: '2026-01-03' }, lifetime: 5, resume: null };
  const m = mergeSaves(a, b);
  assert.deepEqual(m.journey, { unlocked: 5, cleared: { 1: 300, 2: 5 } });
  assert.deepEqual(m.daily, { d: { score: 50 }, e: { score: 1 } });
  assert.deepEqual(m.leaderboard.map((e) => e.score), [99, 10]);
  assert.deepEqual(m.achievements, { a: '2026-01-01', b: '2026-01-03' });
  assert.equal(m.lifetime, 10);
  assert.equal(m.settings.tutorialDone, true);
  assert.equal(m.settings.mute, true);
  assert.deepEqual(m.resume, { r: 1 });
});
