// Orchard Merge — StarHermit platform adapter over the shared SDK
// (starhermit-sdk.js, loaded by index.html as window.StarHermit).
// Hosted mode = the SDK read a launch token (#game_token / #access_token);
// the SDK owns the token and its renewal, the `game:<slug>` cloud-save slot,
// the per-player settings KV, controls and read-only leaderboards. Without a
// token no request of any kind is made (no own-server /api or /ws routes).

const sdk = () => (typeof window !== 'undefined' && window.StarHermit) || globalThis.StarHermit || null;

export const platform = {
  online: false,
  nickname: null,
  avatar: null,
  syncState: 'offline',       // offline | saving | synced | error
  // set by main.js: buildSaveDoc() -> doc, adoptRemote(doc), onStatus(), onAuth({signedIn})
  hooks: {},
  _pushTimer: null, _pushing: false, _adopting: false, _lastSig: null, _inited: false,
  _cloudReady: false,          // true once the start-up loadCloud() has resolved

  get hosted() { const s = sdk(); return !!(s && s.signedIn && s.slug); },
  get sub() { return this.hosted ? sdk().userId : null; },
  get slug() { const s = sdk(); return s ? s.slug : null; },

  /** Read the launch token once (SDK) and follow sign-out on refused renewal. */
  init() {
    const s = sdk();
    if (!s || this._inited) return this.hosted;
    this._inited = true;
    s.init();
    let was = this.hosted;
    s.on('auth', (a) => {
      if (a.signedIn === was) return;   // renewals change nothing visible
      was = a.signedIn;
      if (!a.signedIn) { this.nickname = null; this.avatar = null; this.syncState = 'offline'; }
      this._status();
      if (this.hooks.onAuth) this.hooks.onAuth(a);
    });
    return this.hosted;
  },
  _status() { if (this.hooks.onStatus) this.hooks.onStatus(); },
  setSync(state) { this.syncState = state; this._status(); },
  now() { return Date.now(); },

  // The device clock sets the daily boundary; no own-server time route is
  // called (standalone or hosted).
  async fetchTime() { this.online = this.hosted; },

  // ---- identity: profile nickname (fallback "Player " + id prefix) + avatar ----
  async fetchNickname(userId) {
    const p = this.hosted ? await sdk().profile(String(userId)) : null;
    return p ? p.displayName : 'Player ' + String(userId).slice(0, 6);
  },
  async fetchProfile() {
    if (!this.hosted) return;
    this.nickname = await this.fetchNickname(this.sub);
    this._status();
    const url = await sdk().avatarUrl();
    if (url) { this.avatar = url; this._status(); }
  },

  // ---- cloud save: the `game:<slug>` slot. localStorage stays the offline
  // cache; the cloud slot is a mirror and wins on load conflict. ----
  saveSignature(doc) { return JSON.stringify(doc.save); },
  // No push before the start-up load resolves: the doc is built from live local
  // state, so a debounced push or a hide/pagehide flush during the load would
  // PUT the stale local copy over a newer cloud save (which is then adopted
  // locally without being re-pushed). loadCloud() seeds an empty slot itself.
  scheduleCloudPush() {
    if (!this.hosted || this._adopting || !this._cloudReady) return;
    clearTimeout(this._pushTimer);
    this.setSync('saving');
    this._pushTimer = setTimeout(() => this.flushCloud(), 2000);
  },
  async flushCloud() {
    if (!this.hosted || !this._cloudReady || this._pushing || !this.hooks.buildSaveDoc) return;
    clearTimeout(this._pushTimer);
    const doc = this.hooks.buildSaveDoc();
    const sig = this.saveSignature(doc);
    if (sig === this._lastSig && this.syncState === 'synced') return;
    this._pushing = true;
    try {
      if (!(await sdk().writeSave(JSON.stringify(doc), { keepalive: true }))) throw new Error('cloud-save-failed');
      this._lastSig = sig;
      this.setSync('synced');
    } catch {
      this.setSync('error');
    } finally {
      this._pushing = false;
    }
  },
  async loadCloud() {
    if (!this.hosted) return;
    try {
      let doc;
      try { doc = await sdk().loadJSON(); } finally { this._cloudReady = true; }
      if (!doc) {               // no remote save yet: push the local doc
        this._lastSig = null;
        await this.flushCloud();
        return;
      }
      if (typeof doc !== 'object' || !doc.save || typeof doc.save !== 'object' || !doc.save.settings) {
        throw new Error('bad-cloud-doc');
      }
      this._adopting = true;
      try { if (this.hooks.adoptRemote) this.hooks.adoptRemote(doc); } finally { this._adopting = false; }
      this._lastSig = this.hooks.buildSaveDoc ? this.saveSignature(this.hooks.buildSaveDoc()) : null;
      this.setSync('synced');
    } catch {
      this.setSync('error');
    }
  },

  // ---- per-player settings KV and keyboard bindings ----
  async getSettings() { return this.hosted ? sdk().getSettings() : null; },
  patchSettings(obj) { if (this.hosted) sdk().patchSettings(obj); },
  async loadBindings(defaults) {
    if (!this.hosted) return JSON.parse(JSON.stringify(defaults));
    try { return await sdk().loadBindings(defaults); } catch { return JSON.parse(JSON.stringify(defaults)); }
  },

  // ---- sign-in / invite ----
  canSignIn() { const s = sdk(); return !!(s && s.canSignIn()); },
  signIn() { const s = sdk(); return !!(s && s.signIn()); },
  inviteLink() { return this.hosted ? sdk().inviteLink() : null; },

  // Read-only platform leaderboard (first board); null when none exists or
  // unreachable. Clients can never submit to it.
  async fetchLeaderboard(pageSize = 50) {
    if (!this.hosted) return null;
    try {
      const res = await sdk().leaderboard(null, { pageSize });
      if (!res || !res.board) return null;
      const rows = [];
      const items = res.items || [];
      for (let i = 0; i < items.length; i++) {
        const e = items[i];
        rows.push({
          rank: e.rank != null ? e.rank : i + 1,
          name: e.userId ? await this.fetchNickname(e.userId) : (e.username || 'Player'),
          score: e.score,
        });
      }
      return rows;
    } catch { return null; }
  },
};
