// Orchard Merge — merge two save documents (pure; unit-tested in tests/platform.test.mjs).
//
// Used when the cloud copy and this device's copy differ: at the start-up load and
// after a cloud write lost to another device (StarHermit `saveconflict`). Nothing
// either side earned is dropped: journey unlocks and stage bests take the larger
// value, dailies keep the better score per day, ranked runs are unioned (top 50),
// achievements are unioned (earliest unlock), lifetime points take the larger
// total. This device keeps its settings and its in-progress run (the cloud's run
// is used only when this device has none).

const clone = (o) => JSON.parse(JSON.stringify(o ?? null));

export function mergeSaves(remote, local) {
  const r = clone(remote) || {};
  const l = clone(local) || {};
  const out = { ...r, ...l };
  out.settings = { ...(r.settings || {}), ...(l.settings || {}) };
  out.settings.tutorialDone = !!(r.settings?.tutorialDone || l.settings?.tutorialDone);

  const rj = r.journey || { unlocked: 1, cleared: {} }, lj = l.journey || { unlocked: 1, cleared: {} };
  const cleared = { ...(rj.cleared || {}) };
  for (const [k, v] of Object.entries(lj.cleared || {})) cleared[k] = Math.max(cleared[k] ?? 0, v ?? 0);
  out.journey = { unlocked: Math.max(rj.unlocked || 1, lj.unlocked || 1), cleared };

  const daily = { ...(r.daily || {}) };
  for (const [d, v] of Object.entries(l.daily || {})) if (!daily[d] || (v?.score || 0) > (daily[d].score || 0)) daily[d] = v;
  out.daily = daily;

  const seen = new Set();
  out.leaderboard = [...(l.leaderboard || []), ...(r.leaderboard || [])]
    .filter((e) => { const k = `${e.mode}|${e.hash}|${e.date}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

  const ach = { ...(r.achievements || {}) };
  for (const [k, v] of Object.entries(l.achievements || {})) ach[k] = !ach[k] || String(v) < String(ach[k]) ? v : ach[k];
  out.achievements = ach;
  out.lifetime = Math.max(r.lifetime || 0, l.lifetime || 0);
  out.resume = l.resume || r.resume || null;
  return out;
}
