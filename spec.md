# Orchard Merge — Product and Game Specification

**Document status:** design specification only; no implementation is included.  
**Game index:** 19  
**Genre:** Physics merge puzzle  
**Players:** 1 player; optional asynchronous score comparison  
**Targets:** desktop browsers, mobile browsers, landscape and portrait where practical  
**Rendering direction:** Three.js-first presentation with a fully usable semantic HTML interface layer

## 1. Product vision

Orchard Merge is a game in which players drop round fruits into a container; equal sizes combine into the next size while physics prevents overflow. Its signature setting is a sunny market stall with a transparent produce crate. The product should feel immediately understandable, responsive within one input, and polished enough that the board or playfield itself is the visual hero. Sessions should begin quickly, make the next useful action obvious without solving the game for the player, and end with a clear explanation of score and progress.

The experience must be original. Do not copy names, layouts, characters, iconography, writing, audio, progression maps, or level data from an existing title. Use an original visual language, original procedural assets, and internally authored content.

### Design pillars

1. **Readable before spectacular:** legal actions, hazards, selection, ownership, and goals remain legible with effects disabled.
2. **One-input confidence:** every press, tap, drag, key, or pointer action gives immediate visual and sonic acknowledgment.
3. **Short path to play:** a returning player reaches the primary playfield in at most two deliberate actions.
4. **Fair mastery:** randomness is seeded and inspectable; outcomes never depend on hidden purchases or invisible stat boosts.
5. **Scalable beauty:** the same art direction survives low-power mobile hardware and high-resolution desktop displays.

## 2. Core game design

### Objective and rules contract

Drop round fruits into a container; equal sizes combine into the next size while physics prevents overflow.

The rules engine must represent legal actions independently from rendering. It must expose legal-action queries, deterministic resolution, serializable state, a monotonically increasing turn/tick number, and a terminal-state reason. Tutorials and hints call the same legal-action API used by play rather than duplicating rules.

### Core loop

The repeated loop is: **aim a drop, release, simulate settling, merge equal objects, and manage the height line**. Input is locked only during the shortest non-interruptible resolution phase. Cosmetic animation may continue after the logical state is ready, but skip/fast-forward must settle every object into the exact deterministic end state.

### Scoring and victory

Score each merge by tier; end only after an object remains above the warning line for a grace period. Results show a component breakdown rather than one unexplained total. Store integers for score and simulation units; format values only in presentation. Ties use, in order: primary objective completion, fewer invalid actions, lower authoritative elapsed time, then stable session identifier.

### Modes

- **Learn:** interactive lessons introduce one rule at a time and require the player to perform the action.
- **Journey:** authored progression with gradually combined mechanics and periodic mastery stages.
- **Daily:** one shared seed and ruleset per UTC day, from the device clock (UTC).
- **Practice:** selectable difficulty, restart, undo where rules permit, and no effect on competitive rating.
- **Challenge:** constrained goals such as move limits, speed targets, altered layouts, or restricted tools.
- **Score chase:** asynchronous global and friends comparisons using validated seeds and rulesets.

### Difficulty and content generation

- Represent content as versioned data: identifier, seed, initial state, goals, allowed mechanics, par values, tutorial flags, and presentation theme.
- Run offline validators to prove basic legality, reachable goals, bounded duration, and absence of soft locks. Logic puzzles additionally require a unique or explicitly accepted solution class.
- Difficulty is measured from solution depth, branching factor, time pressure, motor precision, hidden information, and recovery options—not merely larger numbers.
- Introduce one new concept in isolation, combine it with one known concept, then test mastery before adding another.
- Daily seeds are immutable after publication. If content is defective, mark the day excluded from ranking rather than silently replacing it.

### Game-state model

`boot → title → profile-ready → mode-select → preparing → tutorial/countdown → active ↔ paused/reconnecting → resolving → results → progression`.

Every transition has one owner and an explicit reason. Backgrounding pauses solo simulation. In hosted play, the authoritative clock continues where rules require it, while the returning client receives a fresh snapshot and a concise “while you were away” summary.

## 3. Interaction and user-interface design

### Information hierarchy

1. **Primary:** playfield, current objective, legal interaction target, and immediate danger or turn state.
2. **Secondary:** score/progress, remaining moves or time, opponent/party status where applicable.
3. **Tertiary:** settings, social controls, cosmetics, help, and history.

The Three.js canvas fills the game region but is never the only UI. Menus, text, forms, chat, settings, and assistive descriptions use semantic HTML over or beside the canvas. Maintain a single shared layout model so DOM labels align with projected Three.js targets.

### Responsive layouts

- **Wide desktop (≥1024 CSS px):** centered playfield, objective/progression rail on the left, contextual actions and social/status rail on the right. Maximum line length is 70 characters.
- **Compact desktop/tablet:** playfield remains central; secondary rails collapse into drawers. Pointer hover may preview but never be required.
- **Portrait mobile:** top safe-area status bar, square or perspective-fit playfield, bottom thumb-zone action tray, and sheet-based secondary panels. Never place critical controls under browser chrome or display cutouts.
- **Landscape mobile:** reserve a narrow status rail; preserve at least 44×44 CSS-pixel targets and 8-pixel separation. On short landscape screens (≤500 px tall) the thumb tray puts the aim slider and its buttons on a single row so the crate stays visible.
- **Large screens (above 1600×1000):** `ui-scale.js` sets `--ui-scale` (`min(w/1600, h/1000)`, capped at 2.5); the HUD rails, every overlay screen, banners, the countdown, the toast and the frame-rate meter are CSS-`zoom`ed by it, while the full-stage 3D canvas stays unzoomed.
- React to resize, orientation, device-pixel-ratio, safe-area insets, virtual keyboard, and visibility changes without losing input or restarting the round.

### Screens and overlays

- **Title/home:** Play is dominant and routes by progress — the tutorial on a first visit, the journey stage picker once it is complete — with the tutorial still reachable directly for replay; daily challenge, journey progress, and profile are one level below.
- **Mode setup:** show rules, expected duration, player count, assists, and whether the result is ranked before commitment.
- **Play HUD:** objective, progress, current actor/state, pause, and only context-relevant actions.
- **Pause/settings:** resume first; audio, graphics, controls, accessibility, help, and leave are clearly separated.
- **Results:** outcome headline, score breakdown, progress, achievements, comparison, replay/retry, and next recommended action.
- **Help:** visual rule cards generated from current control mappings and representative legal states.
- Daily challenge, local practice, pause, resume, results, and progression are first-class screens.

### Input

- Pointer/touch: raycast only against explicit interaction layers; use pointer capture for drags; cancel safely on lost capture.
- Touch: distinguish tap, drag, and camera gesture by distance/time thresholds; never require multi-touch for core play.
- Keyboard: directional navigation among legal targets, confirm, cancel, pause, undo/hint where valid, and camera reset.
- Gamepad: focus navigation, primary/secondary actions, pause, and remappable axes/buttons.
- Prevent accidental double commits with action identifiers, not arbitrary long debounce timers. Provide visible drag origin, target preview, and invalid-action explanation.

### Accessibility

- Full keyboard operation and visible focus; DOM equivalents for canvas controls; headings and live regions for objective, turn, score, errors, and results.
- Color is reinforced by shape, texture, icon, or label. Include contrast-safe and common color-vision palettes.
- Reduced-motion mode removes camera swoops, shake, parallax, rapid particles, and large scaling while preserving event timing.
- Independent sliders for music, effects, ambience, and voice; captions/text cues for meaningful audio; no audio-only gameplay.
- Options for larger text, high contrast, left-handed controls, hold-versus-toggle, timing assistance, haptics off, and tutorial replay.
- Announce Three.js board state through a concise navigable model rather than describing every decorative object.

### Localization

- Every player-facing string ships in en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR and it-IT: title, setup, pause, results, settings and help screens, HUD (objective, now/next fruit, board list), fruit names, challenge and achievement text, warnings, toasts and live-region announcements. `src/i18n.js` looks strings up by their US-English text in `src/locales/*.js` (es-ES and fr-CA list only their differences from es-419 and fr-FR, en-GB only its spelling changes); static markup carries `data-i18n` / `data-i18n-aria` / `data-i18n-title`, and the two rich-text help paragraphs use `data-i18n-html` keyed by their authored markup. The Graphics panel and sign-in/invite/leaderboard strings keep their tables in `src/gfx-i18n.js` and follow the same locale. The game name, seeds, hashes and key caps stay as-is.
- Settings → **Language → Game language** (rendered by the shared `game-options.js` inside the Graphics section, reachable from the title and the pause menu) offers **Automatic — <resolved language>** plus the nine locales by native name, with a status line (Saved to account / Saved on this device / Account sync unavailable). A change applies immediately: `<html lang>` updates, markup re-renders, and the objective, HUD, board list, profile line, open setup or results screen, key captions and Graphics labels re-render in place without restarting the run or rebuilding the scene.
- Resolution (`sh-language.js`): explicit game choice → for Automatic, the StarHermit account's `preferredLanguage` (`GET /api/v1/me/language`, signed in only) → `navigator.languages` → `en-US`. Tags map to the nearest shipped locale (`es-MX → es-419`, `en-AU → en-GB`, `fr → fr-FR`, `pt-PT → pt-BR`). The choice (`auto` or a locale) is stored per player in `localStorage['orchard-merge.language.<user|guest>']` and, when signed in, in the per-player settings key `ui.language` as `{ choice }`; a failed settings read never overwrites it and the game never writes the platform preference. Standalone play makes no language request. `?lang=<tag>` forces a locale for the page load (QA links) and hides the selector.
- `tests/i18n.test.mjs` checks that every key used in markup and code (`tests/i18n-keys.mjs`) exists in all nine locales with the same placeholders and inline markup.

## 4. Visual and audio design

### Visual contract

The subject is the active playfield at near-tabletop to room scale, framed so state changes occupy most of the screen. The scene is a sunny market stall with a transparent produce crate. Use an authored camera, original procedural geometry, restrained environmental storytelling, and a deterministic visual seed. The no-post-processing baseline must still communicate hierarchy, depth, selection, and state.

### Three.js scene design

- Use physically based lighting and color management with one dominant key, soft environment fill, and contact grounding. Gameplay colors are tested after tone mapping.
- Build reusable semantic meshes for active pieces, board cells, obstacles, targets, and environment modules. Geometry detail follows silhouette importance and camera distance.
- Use instancing for repeated pieces and props, pooled effects, texture atlases where appropriate, and explicit disposal on scene changes.
- Separate render layers for environment, gameplay, selection/ghosts, effects, and UI anchors. Cosmetic particles never intercept raycasts.
- Selection uses a combination of lift/pose, outline or rim, and grounded marker—not bloom alone. Legal targets preview before commit; invalid targets explain why.
- Event hierarchy: input acknowledgment < legal move < combo/goal < round completion. Reserve camera motion, strong emission, and dense particles for the highest tier.
- Audio uses original short transients tied to logical events, layered material impacts, quiet ambience, and adaptive music stems. Randomized pitch/variant is seeded for replay consistency where recording matters.

### Camera and motion

- Choose orthographic or low-distortion perspective according to depth requirements; expose framing constants rather than magic offsets.
- Camera transitions use authored duration/easing or critically damped springs and remain interruptible. Never animate by cumulative per-frame lerp.
- Decorative motion is paused or reduced when hidden. Gameplay animation derives from simulation state and interpolation alpha, not frame count.
- Camera shake is low-amplitude, event-tiered, disabled by reduced motion, and never changes raycast truth.

### Graphics-skill routing

During implementation, begin with `threejs-skill-router` and load only the following retained skills because they materially affect this visual target:

- `threejs-camera-direction` for deliberate framing and input-safe camera transitions
- `threejs-procedural-geometry` for authored, inspectable meshes instead of primitive-only placeholders
- `threejs-procedural-materials` for coherent PBR surfaces, perceptual parameters, and readable state masks
- `threejs-procedural-animation` for deterministic motion phases, springs, and interruption-safe transitions
- `threejs-procedural-vfx` for bounded particles, trails, impact accents, and event hierarchy
- `threejs-exposure-color-grading` for tone mapping, adaptation limits, and accessible color separation
- `threejs-image-pipeline` for explicit depth/color ownership and pass ordering
- `threejs-visual-validation` for fixed-view captures, seed sweeps, and performance evidence

Follow the skill pack's acceptance gate: deterministic seeds, debug views for controlling fields, perceptually grouped parameters, mechanism-backed quality tiers, and a readable no-post baseline. Do not add an effect merely because a skill exists.

### Graphics

**Graphics.** The scene is a sunny market stall: a plank table on legs over textured grass, four posts, a cream back cloth behind the crate (a light, even backdrop for every fruit colour), a red-and-cream striped awning with a scalloped valance, and a distant instanced orchard (trees hung with fruit) on rolling hills under a painted sky whose clouds drift. The crate has a wooden floor and corner frame with faint glass panes and no front pane. Lighting uses ACES filmic tone mapping with sRGB output, a warm key sun whose PCF shadow frustum is fitted to the stall, a sky/grass hemisphere fill and optional `RoomEnvironment` image-based lighting. Fruit keep their palette colours at every quality; on the detailed tier they use physical materials with per-fruit gloss (clearcoat, velvety sheen on the peach, dimpled micro-relief, shallow pumpkin ribs) and pointed leaves (the leaf count still equals the tier). The drop preview shows the actual next fruit. Optional effects: GTAO ambient occlusion, bloom limited to emissive accents (the hot warning line, merge ring flashes; threshold 0.92), a colour grade with vignette, FXAA/SMAA/MSAA, tier-coloured juice bursts with a ring flash, a short pop-in for newly merged fruit, pollen motes and drifting clouds; decorative motion stops with the Reduced motion setting or `prefers-reduced-motion`. Settings → **Graphics** offers a quality preset (Auto, chosen from the StarHermit hardware level below; Low; Balanced; High; Ultra), a render scale (50–200% of the preset's), one override per category (shadows off/low/medium/high, ambient occlusion off/on/high, bloom, colour grade, anti-aliasing off/FXAA/SMAA/MSAA, reflections, scenery detail plain/detailed, merge particles off/low/high, background motion static/animated; each defaults to "From preset (…)", and choosing a preset clears overrides), adaptive resolution (averages 90 frames and steps down to 60% when frames are slow, back up when fast), a frame-rate readout (bottom-left, never over controls), and a summary line "GPU · Level N · cost · W×H px" ("Level" localized). Pixel ratio is min(device ratio, preset cap: Low 1, Balanced 1.5, High/Ultra 2) × preset scale × render scale × adaptive scale; Low renders without a composer. Changes apply immediately and are saved with the other settings (`settings.gfx` in the save and cloud save; the old low/med/high `quality` value migrates to Low/Auto/High). The panel's strings are localized (en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT) and follow the game language. If post-processing cannot be built, the game renders without it and the panel says so. Each fruit's leaf ring is one pre-merged mesh per tier (same leaves and count), so a fruit costs four draw calls on every preset. The overlay screens' frosted backdrop blur is drawn only on High and Ultra (`body.gfx-hud-blur`); below that the same translucent tint shows without it.

**Hardware-level detection.** `src/gpu-level.js` (shared StarHermit copy, `window.StarHermitGpu`, a classic script loaded before `src/main.js`, never edited here) rates the WebGL unmasked renderer plus device facts (`detectSystem()`: phone/tablet, cores, memory, screen) on the StarHermit hardware level 0–20 (0 = Galaxy S20 / Intel UHD or weaker, every software renderer and no WebGL; 20 = RTX 5090; each level ≈ 1.23×; laptop parts two levels below desktop; phones, tablets and ≤ 4 GB machines capped at 9). `src/gfx.js` maps it with `presetForLevel(level, { low: 0, balanced: 4, high: 10, ultra: 17 })`, so Auto picks Ultra on strong GPUs; adaptive resolution still steps down when slow. Headless SwiftShader is level 0 → Low. Phones and tablets pace Auto FPS at half the display refresh rate ("Auto (half refresh rate)") and start at 16 simultaneous sounds (shared `game-options.js`).

**Per-preset budgets** (`BUDGETS` / `budgetFor` / `sparkCap` in `src/gfx.js`). Each preset holds 60 FPS on the weakest GPU Auto gives it — Low at level 0, Balanced 4, High 10, Ultra 17. Fruit sizes, physics, the crate, controls and rules are identical on every preset; only visuals change. Droplet and mote counts are tuned at the floor level and scale up within the preset on faster GPUs (`StarHermitGpu.scaleBudget`, ≤ 2×, at most 480 / 300).

| Budget | Low | Balanced | High | Ultra |
|---|---|---|---|---|
| Stall and fruit shading | Lambert | Standard | glossy Physical skins (Detail on) | as High |
| Fruit sphere segments | 20×14 | 28×20 | 40×28 | 56×36 |
| Fruit-skin micro-relief (bump + roughness) | no | no | yes | yes |
| Procedural texture scale (wood, awning, cloth, grass, sky) | ½ | 1× | 1× | 2× |
| Orchard trees / hanging fruit per tree (Detail on) | half / 2 | half / 3 | all / 6 | all / 8 |
| Juice droplets at Particles high (low: 40 %) | 100 | 120 | 160 | 240 |
| Pollen motes (Background animated) | 40 | 60 | 90 | 150 |
| Bloom / GTAO resolution | ½ | ½ | ½ | full |
| Frosted overlay blur | no | no | yes | yes |

**Benchmark** (`node tools/gfx-bench.mjs orchard-merge`; hook `tests/gfx-bench.mjs` picks the preset in Settings → Graphics, starts a Practice run and keeps dropping fruit across the crate with the visible aim and Drop controls, retrying from the results). Measured 2026-10-17 (GPU ms above the draws-skipped floor, projected to the preset's floor level; CPU p90 on the RTX 5090 run):

- Desktop 1920×1080: PASS low (typical 0.00 / slow 0.52 ms GPU, CPU 1.00 ms); PASS balanced (4.12 / 4.22, CPU 1.70); PASS high (3.70 / 4.23, CPU 2.40); PASS ultra (3.92 / 4.15, CPU 2.30).
- Mobile 390×844 @3×: PASS low (0.07 / 0.02, CPU 1.00); PASS balanced (0.34 / 0.13, CPU 1.50).

Graphics files: `src/gpu-level.js` (shared hardware-level module), `src/gfx.js` (pure quality model: presets, categories, `detectLevel`, `presetForLevel`, `detectPreset`, `BUDGETS`, `budgetFor`, `sparkCap`, `resolve`, `presetTier`, `describe`, `choosePreset`), `src/gfx-i18n.js` (panel strings and locale picking), `src/render-gfx.js` (procedural textures, orchard backdrop, motes, merge bursts, post chain), `dist/addons/` (three.js r182 post-processing, shader and `RoomEnvironment` addons, matching `dist/three.module.min.js`; mapped as `three/addons/` in the import map), `tests/gfx.test.js` (unit tests: hardware level → preset — SwiftShader/llvmpipe/no WebGL, AMD Radeon Graphics and Intel UHD → Low, Iris Xe → Balanced, GTX 1070 → High, RTX 4080/5090 → Ultra, phones such as Adreno 740 capped at Balanced — the per-preset budget table and the localized level label; the e2e suite drives the Graphics panel at desktop and mobile sizes and checks "Level 0" in the summary), `tests/gfx-bench.mjs` (hook for the platform's `tools/gfx-bench.mjs` GPU benchmark; dev-only).

### Performance budgets

- Target 60 fps at the default tier and a stable 30 fps fallback on constrained mobile hardware.
- Default active gameplay: ≤150 draw calls desktop, ≤90 mobile; ≤350k visible triangles desktop, ≤140k mobile; transient particles ≤20k desktop and ≤5k mobile.
- Cap device pixel ratio by quality tier; dynamically lower render scale before dropping simulation rate. UI text remains native resolution.
- Avoid runtime shader compilation during active play by prewarming required variants. Avoid per-frame allocations in simulation/render loops.
- Quality tiers independently control shadows, environment detail, particles, post effects, antialiasing, and render scale; they never alter rules or visibility of hazards.

## 5. Technical architecture

### Client modules

- `bootstrap`: host handshake, capability detection, asset manifest, lifecycle.
- `rules`: pure deterministic state transitions, legality, scoring, seeded random stream.
- `session`: local or hosted commands, snapshots, prediction policy, reconnect, replay.
- `render`: Three.js scene graph, semantic entity views, camera, lighting, VFX, quality.
- `ui`: responsive DOM shell, focus, localization, settings, overlays, accessibility mirror.
- `audio`: buses, event mapping, focus/background behavior, decode and memory policy.
- `content`: versioned levels, themes, tutorials, validation metadata.
- `i18n` (`src/i18n.js`, `src/locales/`): string lookup, locale wiring through `sh-language.js` (an unmodified copy of the canonical StarHermit language helper), live re-render.
- `save-merge` (`src/save-merge.js`): pure merge of two save documents (cloud vs this device).
- `platform` (`src/platform.js`): adapter over the shared StarHermit SDK (`starhermit-sdk.js`, an unmodified copy of the canonical client loaded as `window.StarHermit`) The game makes no own-server `/api` or `/ws` requests, standalone or hosted.

No module may mutate rules state except through a validated command. Rendering consumes immutable snapshots plus interpolation data. UI state and simulation state are separate so closing a drawer cannot affect a match.

### Determinism, replay, and security

- Fixed simulation step where physics exists; quantize authoritative inputs and define stable collision/order rules.
- Use separate seeded random streams for rules, content decoration, and audiovisual variants. Cosmetic randomness never changes rules.
- Replay envelope: schema version, build/content version, seed, initial hash, timestamp offset, ordered commands each stamped with the simulation tick they were issued on, final tick, periodic state hashes, terminal result. Because the client simulates continuously while the player deliberates, validation must advance the sim to each command's tick before applying it; re-deriving intermediate timing produces a different state.
- Validate all network input for identity, session membership, turn/tick, bounds, rate, payload size, and legal action. Reject duplicates idempotently by command ID.
- Treat client clocks, scores, inventories, roles, physics outcomes, and completion claims as untrusted in competitive contexts.

### Loading and resilience

- Show useful progress by asset group; load core rules/UI first and scenic assets lazily. Provide procedural low-detail substitutes if optional assets fail.
- Cache immutable hashed assets and the last safe local snapshot. Updates activate between rounds, never during one.
- Recover WebGL context by rebuilding GPU resources from retained CPU descriptors. If 3D is unavailable, present a clear compatibility message and preserve account/session state.
- Background tabs reduce rendering to zero or a low heartbeat while preserving required network lifecycle.

## 6. StarHermit integration

### Packaging and launch
- The distribution ships `starhermit.txt` at its root (`name`, `description`, `launch=index.html`, `owner`, `server=score-script.js`, `cover`, and one `control.<action>=<codes> | <label>` line per keyboard action) and `starhermit-sdk.js`, loaded by `index.html` before `src/main.js`.
- All platform traffic goes through the SDK; `src/platform.js` adapts it. `StarHermit.init()` reads `#game_token=` (library launch) or `#access_token=` (direct sign-in return) once and strips it; the slug is the `game_scope` claim. Without a token no platform request is made and guest play is unchanged.
- The SDK renews the launch token before expiry. If renewal is refused the title line returns to guest, a "signed out — playing locally" toast shows, sign-in is re-offered and play continues on localStorage.

### Identity, preferences, and progress
- **Sign-in:** on `*.starhermit.com` without a token the title shows **Sign in with StarHermit** (`StarHermit.signIn()`); hidden when signed in and when running locally.
- **Identity:** the title's profile line shows the avatar and profile nickname (fallback `Player ` + id prefix) with the cloud-sync state.
- **Cloud save:** the versioned, checksummed save document mirrors to the `game:<slug>` slot (2 s debounce, flush on `pagehide`/hidden tab) through `StarHermit.loadJSON` / `writeSave`, so every write after the start-up load is conditional on the version that load saw. On load a remote copy is merged with the local one (`mergeSaves`: journey unlock and per-stage best take the larger value, dailies keep the better score per day, ranked runs are unioned (top 50), achievements unioned with the earliest unlock, lifetime points the larger total; this device keeps its settings and its in-progress run, else the cloud's), and the merge is pushed back when it differs; with no remote save the local doc is pushed. Nothing is pushed or flushed until that load resolves. When another device saved first the SDK refuses the write and emits `saveconflict`: the game re-reads the slot, applies the same merge (without leaving a run in progress) and saves again. localStorage stays the offline cache.
- **Settings KV:** volumes, mute, haptics, graphics, palette, reduced motion, high contrast and larger text are patched to the per-player settings store on change and applied after the cloud load at boot (the account value wins). Tutorial completion stays in the save document.
- **Controls:** keyboard input routes by `KeyboardEvent.code` through `StarHermit.loadBindings()` (platform rebinds over the `control.*` defaults); Help → Controls shows the effective keys. Touch mappings remain on-screen controls.
- **Invite:** signed in, the title shows **Invite a friend**, which copies `StarHermit.inviteLink()` to the clipboard and confirms with a toast.
- Sign-in/invite labels and toasts are localized in all nine locales (`src/gfx-i18n.js` `sh_*`).
- **Language:** Automatic follows the account's preferred language; an explicit choice syncs as `ui.language` (see Localization).
- **Report a problem:** Settings → **Report a problem** (signed in only, from the shared `game-options.js`) files a bug report through `StarHermit.reportBug` with a small non-personal `context.json` (viewport, language, FPS cap, audio limit). Uncaught errors are filed as crash reports through `StarHermit.captureCrashes` (SDK-capped).

### Leaderboards and achievements
- **Platform leaderboard:** signed in, every finished ranked run (Journey, the day's first Daily, Challenge) posts its total through `StarHermit.submitScores` — a practice session whose `score-script.js` (the `server=` platform script; canonical copy in the games repo's `tools/score-script.js`) range-checks it and posts it to the `high-score` board (integer, higher is better, 0–1,000,000). The results screen shows "Leaderboard rank: #N" (or posted / not posted), localized in the nine locales (`src/gfx-i18n.js` `sh_lb*`). Score chase shows the `high-score` board's entries with nickname-resolved rows. Learn, Practice and Daily replays post nothing; standalone play posts nothing and shows no leaderboard line.
- **Local board:** ranked runs are also kept on the local board (top 50 with replay data). `server.js` is the local dev server; the client never calls its routes (`/api/v1/scores`, `/api/v1/time`); the device clock sets the daily boundary. Without a launch token the game makes no network request beyond its static files.
- Achievements are local (part of the save document); no server declares platform achievements.

### Not used
- Sessions, matchmaking, friends picker, session chat, replays, realtime rooms and voice: the game is single-player; `score-script.js` only accepts score posts and `server.js` is a dev static/API server.

## 7. Content, economy, and retention

- Launch scope: tutorial sequence, at least 40 authored stages or equivalent procedural depth, daily challenge, practice, five visual themes, and a mastery track.
- Cosmetic rewards may alter materials, trails, board surrounds, ambience, or profile flourishes, but never hitboxes, timing windows, information, or power.
- Reward cadence: early feedback every session, meaningful unlock every 3–5 sessions, and long-term goals visible without manipulative countdowns.
- No real-money wagering, paid random rewards, forced advertising, energy pressure, punitive streak loss, or purchases that affect competitive outcomes.
- Notifications, if ever added by the host, are opt-in, frequency-capped, quiet-hour aware, and never use false urgency.

## 8. Analytics and privacy

Measure tutorial completion, first meaningful action time, session duration bands, level attempts, quit state, input modality, performance tier, reconnect success, and accessibility feature usage only in aggregate. Use random session identifiers, short retention, and explicit consent where required. Never collect message content, drawings, voice, private board notes, or exact pointer trails as analytics.

Success targets for the first public test: median first-play time under 20 seconds, tutorial completion above 80%, crash-free sessions above 99.5%, p95 input acknowledgment below 100 ms locally, and at least 95% of supported mobile sessions holding their selected frame-rate tier.

## 9. Testing and acceptance criteria

### Rules and content

- Unit-test every legal action, invalid-action reason, scoring component, terminal state, and serialization migration.
- Property-test deterministic replay: the same version, seed, and commands produce identical state hashes.
- Fuzz malformed commands and generated content; prove no hangs, NaN physics, impossible mandatory states, or unbounded loops.
- Golden-test representative easy, medium, hard, interrupted, resumed, and terminal sessions.

### Interface and accessibility

- Test pointer, coarse touch, keyboard-only, gamepad, screen reader, zoom to 200%, reduced motion, high contrast, safe areas, and both mobile orientations.
- Verify focus restoration after every modal, meaningful live announcements, no keyboard traps, and no hover-only instructions.
- Confirm all critical labels fit translated strings at 30% expansion and support right-to-left layout where localized.

### Graphics and performance

- Produce fixed-camera captures for every quality tier, deterministic seed sweeps, no-post baselines, debug-view mosaics, and 10-minute temporal stability runs.
- Profile CPU, GPU, memory, shader compilation, draw calls, triangles, texture memory, and garbage collection on representative desktop and mobile classes.
- Verify effects cannot obscure legal targets, alter picking, leak resources, or continue expensive updates while hidden.

### Platform and network

- Test expired/rotated tokens, privacy settings, rate limits, offline start, reconnect at each game state, duplicate commands, out-of-order events, server restart, and version mismatch.
- Verify achievement idempotency, leaderboard validation, friends-only filtering, cloud-save conflict handling, activity start/end pairing, and server-time countdown accuracy.
- `tests/platform.test.mjs` covers the ETag-conditional cloud-save round trip, a 412 conflict that re-reads, merges and saves, `mergeSaves`, sign-in on a UUID host and zero requests standalone. The browser e2e ends with a language step against a stubbed StarHermit API: the account's preferred `fr-CA` makes Automatic resolve to French (Canada); switching to Deutsch mid-run re-renders settings, pause menu and HUD in place, PUTs `ui.language`, keeps the HUD buttons clear at 390 px, and Report a problem posts to `/reports`.
- For hosted sessions, test disconnect/rejoin, abandonment, timeout, invitation expiry, result reconciliation, replay access, moderation controls, and authoritative cheat attempts.

## 10. Definition of done and non-goals

This specification is ready for implementation when rules examples, content schema, wireframes for all responsive breakpoints, visual target frames, accessibility annotations, authoritative message schema, achievement definitions, leaderboard definitions, and performance test devices are approved.

This document does **not** authorize implementation, asset production, monetization work, native wrappers, real-money systems, or copying any existing product. The initial build should favor one excellent core loop and a coherent original visual identity over feature breadth.

## Browser interference

`browser-guard.js` (loaded from `index.html`) suppresses browser UI that gets in the way of play: the right-click context menu, the iOS long-press callout, copy / cut / paste, and page text selection. Text fields (inputs, textareas, selects, contenteditable) keep normal selection, context menu and clipboard behaviour.


## Sound and frame-rate options

The options panel includes Sound controls for master, music, effects and UI volume, a mute that preserves volume levels, and an Auto or manual concurrent-sound limit (1–64). Changes apply immediately with perceptual volume curves. A shared allocator bounds Web Audio and media playback, including loops and scheduled sources. Graphics includes Auto display refresh or a custom maximum frame rate from 1–1000 FPS; rendering is paced independently of simulation and input. Preferences persist locally, with FPS stored per detected GPU, and reconcile with Starhermit settings when signed in. The controls support keyboard and touch input and the supported English, Spanish, German, French, Portuguese and Italian locales.
