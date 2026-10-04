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
  const calls = [], saves = {}, kv = {};
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push([method, url]);
    const r = (status, body) => new Response(body == null ? null : body, { status });
    if (url.includes('/cloud-saves/')) {
      const key = decodeURIComponent(url.split('/cloud-saves/')[1]);
      if (method === 'PUT') { saves[key] = Buffer.from(JSON.parse(init.body).dataBase64, 'base64'); return r(200, '{}'); }
      return saves[key] ? r(200, saves[key]) : r(404);
    }
    if (url.endsWith('/profile')) return r(200, JSON.stringify({ username: 'u', nickname: 'Tess' }));
    if (url.endsWith('/settings') && method === 'PATCH') { Object.assign(kv, JSON.parse(init.body).settings); return r(200, '{}'); }
    if (url.endsWith('/settings')) return r(200, JSON.stringify({ settings: kv }));
    if (url.endsWith('/controls')) return r(200, JSON.stringify({ actions: [{ action: 'hint', codes: ['KeyJ'] }] }));
    return r(404);
  };
  return { calls, saves, kv, fetch };
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
  assert.equal(srv.calls.length, 0);
});
