# Orchard Merge — Product and Game Specification

**Document status:** running specification of the game as built (StarHermit engine 1.23.0 port).  
**Game index:** 19  
**Genre:** Physics merge puzzle  
**Players:** 1 player; optional asynchronous score comparison  
**Targets:** desktop browsers, mobile browsers, landscape and portrait where practical  
**Rendering direction:** a StarHermit engine script game (TypeScript on the host API, `starhermit:scene` for the three.js-style stall, `starhermit:ui` for every menu and the HUD), played natively by the StarHermit client and in browsers by the engine's web runtime.

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

The 3D stall fills the window but is never the only UI: every menu, the HUD, the board list and the announcements are `starhermit:ui` widgets (screen readers and the browser's accessibility mirror see them).

### Responsive layouts

Layouts are picked each frame from the window's logical size (`native/screens.ts`), as the browser build's media queries did:

- **Desktop (≥ 1024 px wide):** the left rail holds the Objective and the Board list (scrolling past 160 px); the right rail the score, the current and next fruit, and the controls panel (aim slider, Drop, Undo, Hint, Skip, Pause with their key chips).
- **Compact (< 1024 px):** a top bar with the score and the Now / Next / objective badges (wrapping), and the thumb tray at the bottom (Aim slider over Drop, Hint, Undo, Skip, Pause, wrapping, centred).
- **Short landscape (≤ 500 px tall, wider than tall):** the tray is one row (Aim label, slider, buttons) so the crate stays visible.
- Cards (title, setup, pause, results, settings, help) are centred, at most 640 px wide, and scroll when taller than the window (opening at their top). The runtime's interface size and larger text scale everything; the safe area is respected.

### Screens and overlays

- **Title/home:** Play is dominant and routes by progress — the tutorial on a first visit, the journey stage picker once it is complete — with the tutorial still reachable directly for replay; daily challenge, journey progress, and profile are one level below.
- **Mode setup:** show rules, expected duration, player count, assists, and whether the result is ranked before commitment.
- **Play HUD:** objective, progress, current actor/state, pause, and only context-relevant actions.
- **Pause/settings:** resume first; audio, graphics, controls, accessibility, help, and leave are clearly separated.
- **Results:** outcome headline, score breakdown, progress, achievements, comparison, replay/retry, and next recommended action.
- **Help:** visual rule cards generated from current control mappings and representative legal states.
- Daily challenge, local practice, pause, resume, results, and progression are first-class screens.

### Input

- **Keyboard** (`control.*` in `starhermit.txt`, rebindable in the runtime's Options › Controls): ←/A and →/D aim (0.5 units a press; held keys repeat after 0.4 s every 3 steps), Space/Enter/Numpad Enter drop, U undo (practice), H hint, R restart, P/Escape pause and resume. While a widget has key focus (Tab), Space/Enter press it and the arrows move the slider; a click or tap on a HUD button hands the keys back to the game.
- **Gamepad** (`engine.gamepad.*`, new in the port): D-pad or left stick aims, South drops, North undoes, West hints, Select restarts, Start or East pauses.
- **Pointer and touch:** a press on the stall (not on a widget) aims at the pointer's x on the fruit plane (the camera's ray through the press meets z = 0), a drag follows it, the release drops there. The aim slider and every action's button do the same as the keys. Presses are queued and decided after the frame's UI is built, so a press on a widget is the widget's.
- Drops during the cooldown are refused (an invalid-action sound and announcement), as before.

### Accessibility

- Full keyboard operation with visible focus rings; every control is a real UI widget; the Board list is the navigable text equivalent of the crate (fruit by tier with positions); merges, warnings, hints, resumes, achievements and results are announced (`ui.announce`).
- Colour is reinforced by the leaf count (= tier) and the tier number in every label; five palettes including Deuteranopia-safe (Settings › Color palette).
- The runtime's Options own sound volumes and mute, reduced motion (stops the pop-in, bursts, shake, hint bob, drifting clouds and motes), high contrast (the game swaps to the browser build's high-contrast colours), larger text and interface size. Settings › Haptics turns merge/result vibration off.

### Localization

- Every player-facing string ships in en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR and it-IT. `src/i18n.js` looks strings up by their US-English text in `src/locales/*.js` (es-ES and fr-CA list only their differences, en-GB only its spelling changes); the account strings (sign-in, invite, toasts, the leaderboard line) are `src/sh-strings.js`. The two rich help paragraphs keep their old keys (with `<strong>` and key-chip markup), drawn as plain text with the effective keys filled in.
- The language is the runtime's interface language (`preferences().language`: Options › Language, else the account's preferred language, else the device's), mapped to the nearest shipped locale (`native/i18n.ts`); a change shows on the next frame. The browser build's own Language setting (`sh-language.js`, `ui.language`) is replaced by the runtime's.
- `tests/i18n.test.mjs` checks every `T()`/`N()` key in `src/` and `native/` exists in all nine locales with the same placeholders and markup, that no locale carries unused keys, and the account strings.

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

### Graphics

The scene (`native/render.ts`, ported from the browser build's three.js r182 code to `starhermit:scene` with the same geometry, materials and constants) is a sunny market stall: a plank table on legs over textured grass, four posts, a cream back cloth, a red-and-cream striped awning with a scalloped valance, and a distant instanced orchard (trees hung with fruit) on rolling hills under a painted sky whose clouds drift. The crate has a wooden floor and corner frame with faint glass panes and no front pane. ACES filmic tone mapping (exposure 1.05), a warm key sun with PCF shadows reaching past the stall, a sky/grass hemisphere fill and `RoomEnvironment` reflections (environment intensity 0.22); light intensities are r182's ÷ π. Fruit keep their palette colours at every quality: a sphere, a stem, as many leaves as the tier (pointed leaves on detailed looks) and an emissive ring; on High and Ultra glossy physical skins (clear coat, micro-relief, shallow pumpkin ribs). The drop preview shows the actual next fruit under a guide line; the hint marker bobs over the hinted column for 2.5 s; the warning line glows past the bloom threshold while fruit is above it. Effects: GTAO, bloom (0.35 / 0.35 / threshold 0.92), the colour grade with vignette (linear, before the output), FXAA / SMAA / MSAA, tier-coloured juice bursts with a ring flash, the fruit pop-in, a small camera shake, pollen motes and drifting clouds.

The procedural canvas textures (wood, awning, valance, cloth, grass, skin relief, sky, the particle dot) are baked once by the browser build's own painters (`tools/bake-textures.mjs`, Chrome) into `assets/textures/*.png` at scale 1 and 2.

**Quality** follows the runtime's graphics level (Options › Graphics): `frame().quality` picks the browser build's preset row and budget (`native/quality.ts`), and the level within the tier scales droplets and motes (≤ 2×, at most 480 / 300). Render scale, the pixel-ratio cap, adaptive resolution, the frame-rate limit and readout and the GPU summary are the runtime's; the old per-category overrides are not offered.

| Budget | Low | Balanced | High | Ultra |
|---|---|---|---|---|
| Shadows / AO / bloom / grade / AA | off / off / off / off / off | 1024 / off / on / on / FXAA | 2048 / on / on / on / SMAA | 4096 / high / on / on / MSAA |
| Reflections, detailed scenery | no | yes | yes | yes |
| Stall and fruit shading | Lambert | Standard | glossy Physical skins | as High |
| Fruit sphere segments | 20×14 | 28×20 | 40×28 | 56×36 |
| Fruit-skin micro-relief | no | no | yes | yes |
| Baked texture scale | — | 1× | 1× | 2× |
| Orchard trees / fruit per tree | — | half / 3 | all / 6 | all / 8 |
| Juice droplets / pollen motes | none / static | 48 / 60 | 160 / 90 | 240 / 150 |
| Bloom / GTAO resolution | ½ | ½ | ½ | full |

The old frosted (blurred) overlay backdrop on High/Ultra is not ported: the cards dim the stall with the same tint on every level. The peach's velvet sheen is left out (the engine draws no sheen).

### Performance budgets

- Target 60 fps at the default tier and a stable 30 fps fallback on constrained mobile hardware.
- Default active gameplay: ≤150 draw calls desktop, ≤90 mobile; ≤350k visible triangles desktop, ≤140k mobile; transient particles ≤20k desktop and ≤5k mobile.
- Cap device pixel ratio by quality tier; dynamically lower render scale before dropping simulation rate. UI text remains native resolution.
- Avoid runtime shader compilation during active play by prewarming required variants. Avoid per-frame allocations in simulation/render loops.
- Quality tiers independently control shadows, environment detail, particles, post effects, antialiasing, and render scale; they never alter rules or visibility of hazards.

## 5. Technical architecture

### Client modules

- `src/rules.js` — the deterministic rules (classic UMD script; loaded by the engine with `loadClassic`, by Node tests and `server.js` with `require`), unchanged.
- `src/progress.js` — content and save model: palettes, fruit names, journey stages, challenges, achievements, the save document's reader, the browser build's cloud document reader, the game's options; `src/save-merge.js` — the merge of two saves.
- `src/i18n.js`, `src/locales/`, `src/sh-strings.js` — strings.
- `native/main.ts` — the entry: the run (60 Hz fixed steps, countdown, drops, undo, hints, fast-forward settling spread over frames, tutorial steps, results, achievements, journey and daily progress, local best runs with replays, leaderboard posting), navigation, input, lifecycle.
- `native/screens.ts` — every screen and the HUD; `native/style.ts` + `assets/ui-style.json` (from `tools/ui-style.css`, `npm run css`) — the look; `native/render.ts` — the 3D stall; `native/quality.ts` — looks per level; `native/audio.ts` — sound; `native/platform.ts` — saves, options, the player, the clock, leaderboards; `native/rules.ts` — the typed facade over `src/rules.js`.

### Determinism, replay, and security

- Fixed simulation step where physics exists; quantize authoritative inputs and define stable collision/order rules.
- Use separate seeded random streams for rules, content decoration, and audiovisual variants. Cosmetic randomness never changes rules.
- Replay envelope: schema version, build/content version, seed, initial hash, timestamp offset, ordered commands each stamped with the simulation tick they were issued on, final tick, periodic state hashes, terminal result. Because the client simulates continuously while the player deliberates, validation must advance the sim to each command's tick before applying it; re-deriving intermediate timing produces a different state.
- Validate all network input for identity, session membership, turn/tick, bounds, rate, payload size, and legal action. Reject duplicates idempotently by command ID.
- Treat client clocks, scores, inventories, roles, physics outcomes, and completion claims as untrusted in competitive contexts.

### Loading and resilience

- Show useful progress by asset group; load core rules/UI first and scenic assets lazily. Provide procedural low-detail substitutes if optional assets fail.
- Cache immutable hashed assets and the last safe local snapshot. Updates activate between rounds, never during one.
- The runtime owns the GPU device and its recovery; a hidden window gets no frames (the run is saved first) and the simulation does not catch up.
- Background tabs reduce rendering to zero or a low heartbeat while preserving required network lifecycle.

## 6. StarHermit integration

### Packaging and launch
- `starhermit.txt`: `launch=index.html` (the loader `npm run package` writes with `starhermit package --web .`, with `starhermit-files.json`), `engine.api=1`, `engine.entry=native/main.ts`, `engine.version=1.23.0`, `engine.minor=20`, capabilities `platform,storage,clipboard`, `server=score-script.js`, `control.*` and `engine.gamepad.*` per action. `.starhermitignore` leaves out tests, tools, `server.js`, docs and source art.
- Signing in, the session and token renewal are the runtime's; a guest can sign in from the title (**Sign in with StarHermit**, `requestSignIn`). A session that ends shows the "signed out" toast; play continues on the device.

### Identity, preferences, and progress
- **Identity:** the title's profile line shows the player's display name with the cloud-sync state (saving / synced / unreachable), or "Guest — progress is stored on this device."
- **Save:** the save (journey, dailies, ranked runs with replays, achievements, lifetime points, the tutorial flag and the run in progress) is the engine save (`starhermit:storage` `saves`, schema 1): written on the device at once and synced to the account by the runtime. A conflict with another device merges both (`mergeSaves`: nothing either side earned is dropped; this device keeps its run in progress, else the account's). A newer save arriving from the account is merged in.
- **Migration:** the browser build's cloud document in the `game:<slug>` slot (`{ version: 1, savedAt, save }`) shows as foreign: it is read (`readForeign`), merged with this device's save and replaced once (`replaceForeign`); its palette and haptics settings become the game's options unless set since. Guests' old browser localStorage progress does not migrate.
- **Options:** the game's own options (colour palette, haptics) are engine `settings` (`game.palette`, `game.haptics`, synced with the account). The browser build's per-player settings keys (`music`, `sfx`, `amb`, `mute`, `haptics`, `gfx`, `palette`, `reducedMotion`, `highContrast`, `largerText`, `ui.*`) are migrated where they still apply and then removed; sound, graphics, reduced motion, high contrast, larger text, language and key bindings are the runtime's Options (Settings › **Audio, graphics & accessibility** opens them, **Controls** opens rebinding).
- **Invite:** signed in, **Invite a friend** copies the platform invite link (toast).
- **Daily:** the date (UTC) comes from the platform's clock (`serverNow`) when it has answered, else the device's.
- Report a problem and crash reports are the runtime's.

### Leaderboards and achievements
- Results are server-authoritative: signed in, every finished ranked run (Journey stages, the day's first Daily, Challenges) posts its total through `score-script.js` (a practice session whose socket carries `{ type: 'result', scores: { 'high-score': total } }`; the script range-checks it and posts it to the `high-score` board, integer, higher is better, 0–1,000,000). The results show "Leaderboard rank: #N" (or posted / not posted). Score chase shows the local best runs and, signed in, the board's top 50. Learn, Practice and Daily replays post nothing; guests post nothing.
- Achievements are local records in the save (shown on the results); no platform achievements.

### Not used
- Matchmaking, rooms, friends, chat and voice: the game is single-player. `server.js` is the dev static/API server (not part of the package).

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
- `npm test`: `tests/rules.test.js` (rules), `tests/server.test.js` (the dev server's replay validation), `tests/progress.test.mjs` (save reading, the browser build's cloud document, merging, options, content), `tests/i18n.test.mjs`, and `tests/native.mjs`: the web index is current, `tsc`, `starhermit check .` with no warnings, and every `tests/native/*.play` script as a signed-out render check driving the real UI (Journey stages 1–2 to their goals; a Daily to overflow, its replay offer and the Score chase table; Practice by keys and a mouse drag with undo, hint, skip, help, restart, leave and resume; the tutorial on a DPR-3 phone by taps and swipes with the settings card; the Move limit challenge on a DPR-3 landscape phone to its results).
- `npm run test:browser` (`tools/browser-play.mjs`) plays the packaged web build in Chrome on the GPU at desktop, phone and landscape-phone sizes (Journey stage 1 to its goal, Practice with a mouse drag; the tutorial with finger swipes; the Move limit challenge to its results) and fails on console errors.
- Signed-in paths (foreign save, legacy settings, score posting) are covered by unit tests of their logic; they cannot be live-tested here.
- For hosted sessions, test disconnect/rejoin, abandonment, timeout, invitation expiry, result reconciliation, replay access, moderation controls, and authoritative cheat attempts.

## 10. Definition of done and non-goals

This specification is ready for implementation when rules examples, content schema, wireframes for all responsive breakpoints, visual target frames, accessibility annotations, authoritative message schema, achievement definitions, leaderboard definitions, and performance test devices are approved.

This document does **not** authorize implementation, asset production, monetization work, native wrappers, real-money systems, or copying any existing product. The initial build should favor one excellent core loop and a coherent original visual identity over feature breadth.

## Known limitations

- Pre-existing rules behaviour kept for replay compatibility: dropping every fruit exactly at one x can build a perfectly balanced vertical column; it still overflows within a few dozen drops.
- Pre-existing scoring quirk kept (replays and the dev server's validation depend on it): the results list a max-tier bonus that the total does not include (the total is the merge score).
- Hosted multiplayer does not exist; the high-score post is the only server-script use.
- Not ported: the frosted overlay blur, the peach's sheen, the WebGL-context-lost card (the runtime owns the device), the old synthesized sound fallbacks while samples decode, the separate ambience volume (the ambience plays on the music bus at the old 40 % level), the old graphics overrides and the old Language selector (the runtime's Options replace them).
