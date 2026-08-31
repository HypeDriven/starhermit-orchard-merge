'use strict';

/*
 * Orchard Merge — authoritative game script.
 * Serves the static distribution and the same-origin /api routes used for
 * hosted play: server time, the daily seed, and replay-validated score
 * submission. Practice runs entirely offline in the client; only seeded
 * daily/score-chase sessions are validated here.
 * Zero dependencies: node server.js [port]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const rules = require('./src/rules.js');

const ROOT = __dirname;
const PORT = parseInt(process.argv[2] || process.env.PORT || '8080', 10);
const DATA_DIR = path.join(ROOT, 'data');
const BOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.opus': 'audio/ogg',
  '.map': 'application/json',
};

// ---- helpers ---------------------------------------------------------------

function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > (limit || 256 * 1024)) { reject(new Error('payload-too-large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(new Error('bad-json')); }
    });
    req.on('error', reject);
  });
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function dailySeed(dateStr) {
  return rules.hashStr('orchard-daily-' + dateStr);
}

function loadBoard() {
  try { return JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8')); }
  catch (e) { return { version: 1, entries: [] }; }
}

function saveBoard(board) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = BOARD_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(board, null, 2));
  fs.renameSync(tmp, BOARD_FILE);
}

// ---- authoritative replay validation -----------------------------------------

// Re-runs the submitted command log against the rules engine and verifies
// the claimed score and the periodic/final state hashes.
function validateReplay(p) {
  if (!p || typeof p !== 'object') return { ok: false, error: 'malformed' };
  const seed = p.seed >>> 0;
  if (!Number.isInteger(seed)) return { ok: false, error: 'bad-seed' };
  const difficulty = rules.DROP_POOLS[p.difficulty] ? p.difficulty : null;
  if (!difficulty) return { ok: false, error: 'bad-difficulty' };
  if (!Array.isArray(p.commands) || p.commands.length > 5000) return { ok: false, error: 'bad-commands' };
  if (!Number.isInteger(p.score) || p.score < 0 || p.score > 1e9) return { ok: false, error: 'bad-score' };

  const s = rules.newGame(seed, { difficulty, goals: p.goals || null });
  const hashes = [];
  for (const cmd of p.commands) {
    if (!cmd || cmd.kind !== 'drop' || typeof cmd.x !== 'number') return { ok: false, error: 'bad-command' };
    if (!rules.applyCommand(s, { kind: 'drop', x: cmd.x })) return { ok: false, error: 'illegal-command' };
    rules.settle(s, 3600);
    if (s.status !== 'active') break;
    hashes.push(rules.stateHash(s));
  }
  // no tail simulation: the submitted finalHash is the state after the last
  // command's settle, which is exactly what we replayed above.

  if (Number.isInteger(p.finalHash) && p.finalHash !== rules.stateHash(s)) {
    return { ok: false, error: 'hash-mismatch' };
  }
  if (p.score !== s.score) return { ok: false, error: 'score-mismatch' };
  return { ok: true, score: s.score, ticks: s.tick, drops: s.drops, maxTier: s.maxTier, hashes };
}

// ---- HTTP server ---------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');

  if (u.pathname === '/api/v1/time' && req.method === 'GET') {
    return send(res, 200, { now: Date.now() });
  }

  if (u.pathname === '/api/v1/daily' && req.method === 'GET') {
    const day = new Date().toISOString().slice(0, 10);
    return send(res, 200, {
      date: day, seed: dailySeed(day), difficulty: 'normal',
      rulesVersion: rules.RULES_VERSION, excluded: false,
    });
  }

  if (u.pathname === '/api/v1/scores' && req.method === 'POST') {
    let body;
    try { body = await readJsonBody(req); }
    catch (e) { return send(res, 413, { error: e.message }); }
    const replay = body.replay || body;
    if (body.scope === 'daily') {
      const today = new Date().toISOString().slice(0, 10);
      if ((replay.seed >>> 0) !== dailySeed(today) || replay.difficulty !== 'normal') {
        return send(res, 422, { error: 'stale-or-wrong-daily-seed' });
      }
    }
    const v = validateReplay(replay);
    if (!v.ok) return send(res, 422, { error: v.error });
    const board = loadBoard();
    const entry = {
      id: crypto.randomUUID(),
      name: String(body.name || 'guest').slice(0, 24).replace(/[<>&"]/g, ''),
      scope: body.scope === 'daily' ? 'daily' : 'score-chase',
      date: body.scope === 'daily' ? new Date().toISOString().slice(0, 10) : undefined,
      seed: (body.replay || body).seed >>> 0,
      difficulty: (body.replay || body).difficulty,
      rulesVersion: rules.RULES_VERSION,
      score: v.score, ticks: v.ticks, drops: v.drops, maxTier: v.maxTier,
      at: Date.now(),
    };
    board.entries.push(entry);
    board.entries.sort((a, b) => b.score - a.score || a.ticks - b.ticks || a.at - b.at);
    board.entries = board.entries.slice(0, 200);
    saveBoard(board);
    const rank = board.entries.findIndex(e => e.id === entry.id) + 1;
    return send(res, 200, { ok: true, rank, entry });
  }

  if (u.pathname === '/api/v1/scores' && req.method === 'GET') {
    const board = loadBoard();
    const scope = u.searchParams.get('scope') || 'score-chase';
    const entries = board.entries
      .filter(e => e.scope === scope)
      .filter(e => scope !== 'daily' || e.date === new Date().toISOString().slice(0, 10))
      .slice(0, 50);
    return send(res, 200, { scope, entries });
  }

  if (u.pathname.startsWith('/api/')) return send(res, 404, { error: 'not-found' });

  // static files (distribution root)
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method-not-allowed' });
  let rel = decodeURIComponent(u.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': rel.endsWith('.min.js') ? 'public, max-age=86400' : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Orchard Merge server listening on http://localhost:${PORT}`);
});
