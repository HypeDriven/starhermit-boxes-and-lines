# Boxes & Lines — running game design document

**Status:** shipped; this document describes the game as it runs today (present tense). Behaviour that the design wants but the code does not do yet is confined to the final section, "Design intent not yet implemented".

## 1. Overview

**Pitch.** Dots-and-boxes on a lamplit graph-paper desk: draw one edge between two dots, close the fourth side of a box and it folds up out of the paper in your colour — and you draw again.

| | |
|---|---|
| Genre | Turn-based territory strategy (pencil-and-paper classic, single sheet) |
| Players | 1 human vs 1–3 AI rivals locally |
| Session length | 2×3 lesson sheets ≈ 1 min; 4×4 ≈ 3–5 min; 7×7 journey finale ≈ 10 min |
| Platforms | StarHermit engine 1.22.0 script game (host API 1.21): natively in the StarHermit client, in desktop and mobile browsers (portrait and landscape) through the engine's web runtime |
| Rendering | `starhermit:scene` desk, paper, dots, edges and folding boxes; `starhermit:ui` HUD, dialogs and a "button board" mirror that is always on screen and fully playable on its own |
| Networking | None standalone; signed in, the runtime's platform modules carry the cloud save, the game's settings, the invite link, the profile names and the leaderboard post after a ranked sheet (see §12). `server.js` is a local static host whose session/score routes the client does not call |

File map (everything that ships or tests the game):

| Path | Responsibility |
|---|---|
| `starhermit.txt` | Manifest: name, owner, `server=score-script.js`, cover, `launch=index.html`, `engine.api=1`, `engine.entry=native/main.ts`, `engine.version=1.22.0`, `engine.minor=16`, capabilities `platform,storage,clipboard`, 13 `control.*` actions with `engine.gamepad.*` defaults and Options groups |
| `index.html`, `starhermit-files.json` | The web loader and file index `starhermit package --web .` writes (`npm run package`; never edited by hand) |
| `native/main.ts` | Entry module: the sheet in play (session, AI pacing on fixed steps, clock, lessons, end of sheet → stars, bests, stats, achievements, leaderboards), screen state, input routing, lifecycle |
| `native/screens.ts` | Every screen, the HUD, the button board, toast, captions, pause dialog (`starhermit:ui`, immediate mode) and the responsive layouts |
| `native/render.ts` | The desk on `starhermit:scene`: procedural textures, edges, folding boxes, preview / focus rings, seat tokens, bursts, confetti, dust, camera, picking, the look per graphics level |
| `native/quality.ts` | The browser build's four presets and budgets keyed by the runtime's quality tier and level |
| `native/audio.ts` | One-shot clips on the runtime mixer, the rendered room tone and pad, captions |
| `native/platform.ts` | Save document (device + cloud, conflict merge, the browser build's foreign save), game settings, profile names, invite link, high-score post through `score-script.js`, the platform board |
| `native/i18n.ts`, `native/style.ts`, `native/classic.ts` | Interface language → string tables; the style sheet and palette tokens; loading the shared `js/*.js` scripts (with a `localStorage` shim over device storage) |
| `js/rng.js`, `js/rules.js`, `js/content.js`, `js/session.js`, `js/store.js` | UMD rules, content, session, save helpers — shared verbatim by the engine client, `server.js` and the Node tests |
| `js/strings.js`, `js/i18n.js` | Translation tables (English keys) and the localizer (`BLI18N`: `T`, `match`, `setLocale`) |
| `js/migrate.js` | The engine save document and what the browser build left in the account (foreign cloud save, per-player settings) |
| `assets/ui-style.json` | `starhermit css` output of `tools/ui-style.css` (`npm run css`) |
| `assets/title-art.webp`, `assets/results-art.webp` | Key art on the title and on a winning results dialog |
| `score-script.js` | StarHermit platform script: range-checks a finished ranked sheet's total and posts it to the `high-score` leaderboard |
| `server.js` | Local dev server + static host (also serves the package for a local browser run), server-side sessions and authoritative score replay (kept for its tests) |
| `sfx/` | 20 Opus clips, `manifest.txt` (canonical binding table), `manifest.json`, `manifest.md` |
| `coverart.png`, `cover.jpg`, `icon.png`, `favicon.*` | Platform cover, icon, tab icon |
| `tests/` | Unit suites (`run.js`: rules, session, content, store; `server.test.mjs`; `i18n.test.mjs`, `migrate.test.mjs`), `native.mjs` and `native/*.play` (engine checks) |
| `tools/` | `package-web.mjs`, `css.mjs` + `ui-style.css`, `gen-play.mjs` (writes the play scripts), `browser-play.mjs` (headless Chrome play), `validate-content.js`; never packaged (`.starhermitignore`) |

## 2. Vision and design pillars

1. **The paper is the game.** Every rule is visible on the sheet: undrawn edges are faint, drawn edges carry their author's colour, a claimed box physically folds up and takes a shape stamp. Rules in: state that can be read from the board alone; a DOM board that mirrors the 3D one exactly. Rules out: hidden modifiers, off-board resources, any information the sheet does not show.
2. **The third side is the drama.** The whole tension of dots-and-boxes is deciding who has to open a box first. The game makes that moment legible before commitment (green/amber/white preview ghost, "Risky: gives away a box" HUD line, `pencil-press` cue on a giveaway) and rewards the pay-off (extra turn cue, chain flurry at three boxes, Chain Reaction achievement). Rules out: AI that ignores the third side above easy, hints that do anything other than what the hard AI would do.
3. **Determinism you can audit.** Every match is a seed plus an ordered command list. AI moves come from the rules RNG stream, so a replay reproduces the rival's exact play and a verifier (`server.js`) can refuse forged scores. Rules in: seeded prefill, seeded daily, `hashState`, replay envelopes. Rules out: `Math.random()` anywhere in rules or AI; hints that consume the stream.
4. **Never trapped by the pretty layer.** The 3D scene is cosmetic. On any graphics level, or with the scene hard to read on a small phone, the button board, keyboard and gamepad paths play the identical game; the desk only reads rules snapshots. Rules out: any action that exists only in the scene.
5. **Short warm sessions.** One tap from the title starts the next journey stage; a results dialog explains the score in four integer lines; the desk lamp, paper sounds and unhurried pad keep the mood of an evening at a desk rather than an arcade. Rules out: timers on non-timed sheets, streak-shaming, monetised boosts.

## 3. Player experience

**Target player.** Someone who knows the pencil-and-paper game (or learns it in five one-minute lessons) and wants a calm, tactile, offline-friendly version with a real AI curve and something to chase (stars, dailies, six achievements).

**First 60 seconds.** The title dialog opens on load. Its primary card is `▶ Play — Journey 1 — First Lines` (`screens.ts titleCards` picks the first stage without a star). Tapping it starts a 2×3 sheet against Pip (random AI) and toasts the stage intro: "Draw one edge between two dots. Close all four sides of a box to claim it — and draw again." The HUD objective reads "Claim the most boxes", the sub-line "Your turn — pick an edge". Hovering or focusing an edge previews its consequence (Safe line / Risky: gives away a box / Claims a box — draw again!), so the extra-turn rule is taught by the first claim. The Hint button is enabled on every journey stage. Players who want explicit lessons pick **Learn** on the title: five sheets that each require the rule to be performed (`content.js tutorialLessons`). Help (title link or pause) has six cards including the full control list.

**Typical session.** Title → one journey stage (or the Daily Sheet) → results with score breakdown and stars → Next → another stage or back to title. Practice is the sandbox (undo, unranked); Challenge holds six constrained sheets with separate bests.

**Emotional beat.** The pause before opening the first chain: the sheet is full of safe lines, then it is not, and someone must give. Getting that right — or watching Vega count the chains better than you — is what a match is about.

## 4. Core loop and rules contract

All rules live in `js/rules.js`; nothing else mutates a state.

**Board** (`createGame`). A `rows × cols` grid of boxes. `he[r][c]` (`rows+1 × cols`) are horizontal edges, `ve[r][c]` (`rows × cols+1`) vertical edges; `cells[r][c]` is `-1` open, `-2` hole, `≥0` owner index. Edge values: `0` undrawn, `-1` pre-drawn by setup, `p+1` drawn by player `p`. Holes (`cfg.holes`) are excluded from `boxesLeft`; no shipped content uses holes. `prefill` places that many neutral edges from the rules stream, rejecting any that would give a box its fourth side (a third side is allowed, so pre-inked sheets can start with free boxes).

**Players.** `cfg.players[]` of `{name, type:'human'|'ai', ai:'easy'|'medium'|'hard'}`; the human is always index 0 in shipped content. `current` starts at `cfg.startPlayer` (only `c-handicap` sets it to 1).

**Legal actions** (`legalActions`, `checkDraw`). Any in-bounds edge with value `0` while the game is not over. Invalid reasons: `game-ended`, `edge-drawn`, `out-of-bounds`, `unknown-command`, `malformed-command`, `wrong-player`. Invalid commands never mutate state; `session.js apply` counts them per player.

**Resolution order** (`applyCommand` for `{type:'draw', dir, r, c}`):
1. Mark the edge with `current+1`; `turn++`, `moves[current]++`.
2. Emit `draw {player, gives, claims}` — `gives` is true if the edge left any adjacent open box with exactly three sides.
3. For each adjacent open box that now has four sides: set owner, `scores[p]++`, `boxesLeft--`, emit `box {r, c, player, total}` (an edge can claim two boxes).
4. No claim → `current = (p+1) mod players`, emit `pass`. Any claim → emit `extra-turn` and keep the pencil.
5. Terminal check: a `first-to` goal reached ends with `goal-reached` and `winner = p` (never a tie); otherwise `boxesLeft ≤ 0` ends with `board-full`. `resign` ends with `resigned`, `timeout` with `time-up`; all three call `endGame`, which picks the highest score, or `winner = -1` on a shared top score.

**Score breakdown** (`scoreBreakdown(state, playerIdx, elapsedMs)`), integers only:

| Component | Points |
|---|---|
| Boxes claimed | 100 per box |
| Victory | 500 if the player is the winner |
| Winning margin | 25 × (own boxes − best rival boxes), winners only |
| Under par time | 5 × floor((par − elapsed) / 1000), winners only, when `cfg.par.timeSec` exists and elapsed < par |

Worked example: journey stage 1 (2×3, par 120 s) won 4–2 in 80 s → 400 + 500 + 50 + 5×40 = **1150**.

**Journey stars** (`native/main.ts finishGame`): win = 1 star, +1 if margin ≥ `starMargin` (1–5 per stage), +1 if elapsed ≤ par. A stage unlocks when the previous stage has at least one star (`screens.ts journeyScreen`).

**Tie-breaks.** On the sheet: equal top scores are a tie (`winner -1`, "A tie!" headline). On leaderboards (`store.js sortEntries`, `server.js sortEntries`): score desc, then fewer invalid actions, then lower duration, then session id.

**RNG and seeding** (`js/rng.js`). One uint32 master seed per config; `derive(seed, STREAM_RULES)` feeds prefill and AI, `STREAM_DECOR` feeds the daily generator, `STREAM_AV` is reserved for audio variants. The rules stream position is stored in `state.rng`, so `aiMove` is reproducible from state alone. `hashState` is FNV-1a over a key-sorted JSON of the state minus `events`.

**AI** (`aiMove`). Easy: uniform random legal edge. Medium: take the edge with the most claims, else a random safe edge (no third side given), else a random risky edge. Hard: as medium, but when forced to give, opens the smallest chain by `chainOffer` (flood-fill of boxes the opponent could take after the edge). Pip / Margot / Vega are the easy / medium / hard names. **Hint** (`suggest`) is the hard search with the stream position restored afterwards; using it sets `session.assists`, which excludes the result from ranked leaderboards.

**Undo** (`session.js checkpoint/undo`). Only when `cfg.mechanics.undo` (practice presets and lessons). A checkpoint is taken before each human move, so one undo rewinds the human move and every AI reply after it; the stack is capped at 200.

**Clock.** `native/main.ts` ticks the session every 250 ms of fixed steps (15 of the runtime's 60 a second) while the sheet is active, unpaused and no dialog is open (a hidden window pauses it). With `timeLimitSec`, reaching the limit applies `timeout` → `time-up`; the winner is still whoever has more boxes, headline "Time!".

## 5. Modes and progression

| Mode | Entry | Config | Ranked | Undo / Hint |
|---|---|---|---|---|
| Journey | title card / ▶ Play | 40 authored stages `j01`–`j40` (2×3 → 7×7; Pip → Margot → Vega; 2–4 pencils; prefilled ink from stage 3; clocks from stage 10; every fifth stage is a MASTERY stage with a margin target) | yes | no / yes |
| Daily Sheet | title card | `dailyConfig(utcDate)`: seed = hash of `boxes-and-lines:daily:YYYY-MM-DD`; board from {3×3, 4×4, 4×5, 5×5, 5×6}; random AI level; 35 % chance of a clock (≥ 90 s, 12 s per box); 40 % chance of 2–6 pre-inked edges; one of the three always-unlocked themes. Replayable; best score kept; countdown to the next UTC day on the card | yes | no / yes |
| Practice | title card → Practice | Sketch 3×3 / Study 4×4 / Master Sheet 6×6, rival level, fresh random seed | no | yes / yes |
| Challenge | title card → Challenge | Sixty-Second Desk (3×3, 60 s clock), The Long Sheet (6×7), Head Start (Margot opens, 6 inked lines), Four Pencils (three rivals), First to Five (race to 5 boxes, hard AI), Surveyor's Exam (4×4 vs Vega, no hints) | yes | no / per challenge |
| Learn | title card → Learn | L1 draw two lines; L2 close a prepared box; L3 claim two boxes in one turn; L4 draw three safe lines; L5 full 3×3 vs Pip. Goals match rules events (`draw`, `box`, `draw-safe`, `over`) | no | yes / yes |

Difficulty curve: sheet area grows 6 → 49 boxes; rival level steps at stages 5 (Margot) and 15 (Vega); the number of pencils rises to 3 at stage 6 and 4 at stage 19; clocks appear at 10, 17, 20, 23, 30, 34, 38, 40; star margins rise from 1 to 5.

Unlocks: desk themes Midnight Studio at 15 total stars and Rosewood Parlour at 40 (`content.js THEMES`, checked by `native/main.ts themeFor`); journey stages gate on the previous star. Achievements (`store.js ACHIEVEMENTS`): First Box, First Victory, Chain Reaction (3+ boxes in one turn), Ten Sheets In, Daily Habit (three dailies), Five Hundred (500 boxes lifetime). Stats tracked: rounds, wins, boxes claimed, best chain, play time, daily streak.

## 6. Controls and interaction

Actions are declared in `starhermit.txt` (players rebind keys and pads in the runtime's Options › Controls; Help shows the current keys through `bindingLabel`).

| Input | Action | Feedback |
|---|---|---|
| Tap/click an edge in the 3D scene (a ray onto the sheet; hit strips 1 long, 0.32 wide) | Draw it | Pencil burst at the edge, `draw`/`danger` cue, HUD turn line |
| Hover an edge (pointer) or focus one (keys/pad) | Preview | Ghost strip and ring: green `#6fd98a` safe, amber `#e8a13f` risky, white claim; HUD sub-line names the consequence |
| Drag > 6 px on the scene (mouse or finger) | Orbit the camera slightly (clamped ±0.8 units) | No draw is committed |
| Tap an edge button on the button board (or Tab to it and press Enter) | Draw it | Same as scene tap; the button becomes solid in the player's colour |
| `left` `right` `up` `down` — arrows; D-pad / left stick | Move the focus ring to the nearest legal edge in that direction | White ring in the scene, amber outline on the board; the edge is announced |
| `first` / `last` — Home / End; LB / RB | Focus the first / last legal edge | |
| `draw` — Enter, Space, Numpad Enter; A (South) | Draw the focused edge | |
| `cancel` — Backspace; B (East) | Drop the armed (confirm-moves) edge and its preview | |
| `undo` U / X (West), `hint` H / Y (North), `skip` S / Select, `camera` C / right-stick press | Undo (practice, lessons) / Hint / Skip animations / Reset camera | `undo`, `hint`, `ui` cues |
| `pause` — P or Escape; Start | Pause / resume (no dialog open) | Pause dialog, `pause` cue |
| Escape / B with a dialog open | Back, same as the ← Back button | `page` cue on the screen that opens |
| Confirm-moves setting | First tap arms the edge and shows the preview, second tap commits | Toast "Tap again to confirm" |

While a widget has keyboard focus (after Tab) the arrows and Enter belong to the widgets; otherwise they move and use the focus ring and the interface does not take them. Input locking: a pick is ignored unless a sheet is active, unpaused, with no dialog, and it is a human turn; out-of-turn taps play `invalid`. AI replies come 27 fixed steps (450 ms) after the state changes and are held by any pause, undo or teardown. Animations never block input — logical state is ready immediately and Skip settles the folds. Haptics: a 15 ms vibration (`starhermit:input vibrate`) on each own box claim when enabled. Under a dialog the button board is drawn as a picture (no buttons), so it never takes the dialog's clicks.

## 7. Screens and UI flow

`native/main.ts` keeps `app.screen` (title, practice, journey, challenge, learn, settings, help, profile, scores, results, or none while playing) and `app.paused` (the pause dialog, under Settings / Help opened from it). Dialog screens are one paper panel over a dimmed backdrop with a header of ← Back and the screen title; content taller than the panel (`min(680, 92 %)` wide, at most 88 % of the window tall) scrolls inside it. The first control of each screen takes focus when it opens. The ← Back button (and Escape) is hidden on the title when no sheet is in play, so a finished sheet can never strand the player; Back from a dialog opened from pause returns to the pause dialog.

Layout (logical pixels inside the safe area; the runtime's interface size and text size scale everything): the HUD (objective block, status block with turn indicator / score chips / clock, actions block with Hint · Undo · Skip · Pause) above the play region, where the desk is framed (camera view offset) into what the HUD and the button board leave.

- **Desktop (≥ 1024 px).** Three HUD blocks in one row (mirrored for left-handed); the button board centred below the scene.
- **Compact (< 1024 px).** Objective spans the top row; status and actions share the second.
- **Portrait phone (≤ 700 px, portrait).** Status above objective; the actions are a thumb tray of four 48 px buttons at the bottom; toasts sit above the tray.
- **Short landscape (height ≤ 500 px).** One HUD row without the sub-line; the button board is a compact panel beside the scene (`min(38 %, 320 px)` wide).

The button board's cells are square: 18–40 px (14 px on short landscape), sized so the board takes at most 40 % of the play region's height — 55 % and cells up to 56 px with **Always show button board** (Settings), which emphasises the board at the scene's expense. Never cut off: the four HUD buttons, the score chips, the whole button board, the pause dialog's buttons and the Retry / Next / Title row on results (the panel scrolls before anything is clipped). Toasts sit 24 px above the bottom edge (84 px on portrait phones in play); captions sit bottom-left (bottom-right in left-handed layout).

## 8. Art direction

**Hero.** The sheet of graph paper under lamplight, and the moment a box folds up out of it and takes its stamp (`native/render.ts makeFold`, four flaps hinged on the cell edges, `FOLD_TIME` 0.55 s, stamp pops in over the last 65 % of the fold).

**Palette** (tokens in `tools/ui-style.css`): desk `#241b12` / `#2e2318`, paper `#f2ead8` / `#e9dfc8`, paper edge `#d8cbae`, card `#fffdf6`, ink `#2a211b`, ink-soft `#5c4f41`, ink-faint `#8a7a66`, amber `#e8a33f` (focus, primary buttons, active chip), amber-deep `#c9821e`, ruled lines `#cfc0a3`, good `#4e7d4e`, bad `#a8463a`. Players (colour always paired with a stamp shape and a name): You ● `#3f8efc`, Rival ▲ `#ef5d4e`, Third ■ `#e8b23f`, Fourth ◆ `#5fbf77`; high-visibility set `#2e6fe4 / #e4572e / #f5d90a / #17a398` (setting "Player colors"). The runtime's high-contrast option swaps the tokens (`native/style.ts`): desk `#100b06`, paper `#fdf6e6`, ink `#171008`, darker edges and rules.

Desk themes (`content.js THEMES`, 3D palette as hex ints): Graph Paper Desk (desk `6e4a2e`, paper `f2ead8`, grid `9db4c8`, dot `4a4038`, wall `3a2e26`, light `ffd9a8`, fog `2a211b`), Blueprint Table (`2e3a4a` / `27435e` / `7fa8c8` / `d8e4ee`), Kraft Workshop (`7a5a38` / `d8bd8f` / `a8895e` / `4a3520`), Midnight Studio (`2a2530` / `322d3e` / `6a6080` / `c8c0d8`, 15 ★), Rosewood Parlour (`5a2e2e` / `ead8c8` / `b08a80` / `3e2828`, 40 ★). Journey stages carry a theme; the settings theme applies elsewhere.

**Shape language.** Rounded paper cards (10–12 px radii) with soft drop shadows on a dark wood ground; pale outlined buttons for undrawn edges on the button board (solid outlines: the runtime has no dashed borders), solid colour bars for drawn ones; circle / triangle / square / diamond stamps; round "seat" tokens on each side of the sheet that brighten for the player to move.

**Typography.** The runtime's sans font, 16 px base, 1.8 rem dialog titles (22 px on phones); the runtime's text-size option scales it. Tabular numerals on clocks and chips.

**Motion.** Camera FOV 40 with a 14 s idle drift of 0.12 units, 0.8 s eased reset, a rise-and-confetti flourish on game over (`startCamRise`, pooled ≤ 260 paper chips), pencil bursts on every draw. With ambient motion on, dust motes drift in the lamp light above the sheet and the active seat token breathes gently. **Reduced motion** (the runtime's accessibility option): folds take 0.15 s, every event animation is capped at 0.3 s, no drift, camera rise or confetti, dust motes are hidden and the seat token holds still.

**Graphics.** Lighting is a warm key directional light plus a hemisphere fill (three.js r160 intensities ÷ π, the engine's convention), ACES filmic tone mapping at exposure 1.05. The look follows the runtime's graphics level (Options › Graphics: Auto from the detected device, or the player's choice; the runtime also owns render scale, the pixel-ratio cap, adaptive resolution, the frame-rate limit and readout). `native/quality.ts` maps the level's tier (`frame().quality`) to the browser build's four presets:

| | Low | Balanced | High | Ultra |
|---|---|---|---|---|
| Shadows (key light, `renderer.shadowMap`) | off | 1024² | 2048² | 4096² (softer edge) |
| Ambient occlusion (`renderer.ao`) | off | off | on (8 samples) | high (16) |
| Bloom (`renderer.bloom`, threshold 0.88; the active seat token is HDR so it glows) | off | ½ res | ½ res | full |
| Colour grade (`renderer.grade`: gentle S-curve, saturation 1.1, cool shadows / warm highlights, 0.34 vignette) | off | on | on | on |
| Anti-aliasing (`renderer.antialias`) | MSAA | FXAA | SMAA | MSAA |
| Reflections (three's `RoomEnvironment` prefiltered with `PMREMGenerator`, intensity 0.3, low per-material intensities) | off | on | on | on |
| Materials | Lambert | Standard | Physical (clearcoat pins and strips) | Physical |
| Surface detail (wood-grain normal + roughness map on the desk, paper-fibre normal map on the sheet and boxes) | plain | detailed | detailed | detailed |
| Desk texture / relief | 256 / 128 px | 512 / 256 | 1024 / 512 | 2048 / 1024 |
| Sheet grid texture | 32 px per cell | 48 | 64 | 96 |
| Ink-pin segments | 8 | 12 | 16 | 24 |
| Particles (bursts, confetti; cap 80 / 300) | low | high | high | high |
| Confetti chips · dust motes | 40 · 12 | 90 · 24 | 160 · 36 | 220 · 48 |
| Ambient motion (dust motes, seat-token pulse) | still | animated | animated | animated |

Within a tier the confetti and dust counts grow with the level above the tier's first (≈ 1.64× a level, at most 4×, capped at the 260-chip / 48-mote pools). A level change rebuilds materials and the sheet live. The title and menus sit over a small half-played sheet with two folded boxes. Gameplay is identical at every level.

**Visual assets the design calls for:** title key art (a lamplit desk with stamped paper boxes) above the mode cards; a victory vignette (one folded box, bell, confetti) on winning results; a cover in the same still-life language; the icon and favicon. See §15 for status.

## 9. Audio direction

**Philosophy.** Everything is something you could hear at a desk: graphite, paper, wood, a brass bell, an old clock. No synth stingers as the primary voice — synthesis exists only as the fallback while a clip loads or if it 404s. Cues are short (≤ 3 s) and never stack on the music.

**Mixer** (`native/audio.ts`): the runtime's buses — music (the pad, gain 0.55), effects (cues at 0.9 and the room tone at 0.5) and interface (the Skip tap); Options › Audio owns the volumes, mute and voice limit. Ambience is a looped room tone of brown noise through a 320 Hz low-pass at 0.16 gain, rendered once into a 6 s clip with cross-faded ends; music is the generative sine pad on a G3 pentatonic set, each step's 3.2 s swell rendered into a clip and played every 2.56 s of mixer time, the next step 1–3 notes on. Clips load one at a time once the mixer runs (in a browser after the first press); a cue whose clip is not loaded yet is silent (the browser build's synthesized stand-ins are not ported: the web runtime drops clip loads while a synthesis graph changes). The beds hold while paused or hidden. Captions (setting) show each cue's text (translated) for 1.5 s.

**SFX event table** (source of `sfx/manifest.txt`; every clip is fetched lazily and decoded once):

| Event id | File | Sound | Usage |
|---|---|---|---|
| draw | pencil-line.opus | short graphite stroke on rough paper | any safe edge drawn |
| danger | pencil-press.opus | hard, tense pencil scrape with a creak | edge that gives a box its third side |
| box | box-fold.opus | crisp paper crease and tuck | human claims a box |
| box-rival | rival-box.opus | dull paper thud on wood | rival claims a box |
| extra | extra-turn.opus | two cheerful pencil taps | extra turn granted |
| chain | chain-flurry.opus | three quick folds and a bright tap | third box of one turn (new) |
| invalid | eraser-thump.opus | eraser thumped twice, refusing | rejected input |
| undo | erase-line.opus | eraser rubbing out a line | undo |
| hint | hint-tap.opus | two fingernail taps on paper | hint shown |
| ui | ui-tap.opus | soft fingertip knock on wood | Skip button |
| page | page-turn.opus | one sheet turned over and settling | any dialog screen opening (new) |
| pause | pencil-down.opus | pencil set down on the desk | pause overlay (new) |
| star | star-chime.opus | brass desk bell, single ding | achievement unlocked |
| tick | clock-tick.opus | one mechanical clock tick | last 10 s of a timed sheet |
| win | win-slap.opus | palm slap, papers flutter, pencil drumroll | match won / lesson complete |
| lose | page-drop.opus | sheet slides off the desk to the floor | match lost |
| drawn-game | tie-tap.opus | two pencils clack in salute | tie |
| hover / select / turn | pencil-hover / menu-select / turn-tap.opus | faint tip tick / page turn with press / quiet pencil tick | bound in `native/audio.ts`, not yet triggered |

## 10. Localization

Nine locales ship: **en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT**.

- **Strings.** Code and content are authored in English, and the English text is the lookup key. `js/strings.js` holds one row per key with es-419, de-DE, fr-FR, pt-BR and it-IT; en-GB, es-ES and fr-CA list only their differences. `T(key, vars)` (`js/i18n.js`, through `native/i18n.ts`) falls back regional → parent → English and fills `{name}` placeholders. Everything a player reads goes through it: screen titles, cards, setup, lists and their names, intros and goals, results, Settings, Help, Profile, Scores, the HUD, pause dialog, toasts, captions, screen-reader announcements, the button board's accessible names and the account / leaderboard lines. "Boxes & Lines" and the rivals' names (Pip, Margot, Vega) are not translated.
- **Language.** The interface language is the runtime's (`preferences().language`: the player's choice in Options › Language, else the account's preferred language, else the device's), mapped to the nearest shipped locale (`es-MX → es-419`, `en-AU → en-GB`, `fr → fr-FR`, `pt-PT → pt-BR`; unsupported languages → en-US) and passed to `ui.setLanguage`. A change re-renders every screen on the next frame; the sheet in play, its clock and the AI are untouched. The game has no language menu of its own.
- `tests/i18n.test.mjs` extracts every key `native/*.ts`, the content and the rules use and fails when a full locale lacks one, a translation drops a placeholder or a table holds an unused key.

## 11. Accessibility

- **Keyboard / pad-only path.** Every screen control is a `starhermit:ui` widget in Tab / D-pad order, focused on open; the sheet is playable with the focus ring (arrows + Enter, D-pad + A) or by tabbing through the button board's edge buttons (each named "horizontal/vertical edge row r column c", with ", drawn by Name" or ", pre-drawn" once taken, and disabled).
- **Focus.** A 3 px amber ring on widgets, the white focus ring mesh in the scene and an amber outline on the board; a hint lights the suggested board button for 1.6 s.
- **Screen reader.** `ui.announce` speaks sheet start and objective, turn changes, focused edges, hints, undo, pause/resume, lesson completion and the final score line.
- **Captions** for sound cues (setting).
- **Contrast and colour.** Paper-on-dark palette; the runtime's high contrast swaps the tokens; player colour is always doubled by a shape stamp and a name; a high-visibility player palette exists for colour-vision deficiency.
- **Motion.** The runtime's reduced-motion option (see §8).
- **Text and size.** The runtime's interface-size and text-size options scale the whole interface.
- **Other.** Left-handed layout (HUD and tray mirrored, captions on the right), confirm moves (two-tap commit), haptics toggle, an emphasised button board.

## 12. StarHermit integration

`starhermit.txt` (see §1) makes the game an engine script game; the platform runs `score-script.js` for score posts.

- **Identity.** Signed in, the title's account line reads "Playing as <nickname> · progress synced / saving… / cloud sync unavailable"; offline "Offline — progress is stored on this device."; after the session ends "Signed out of StarHermit — progress stays on this device." **Sign in with StarHermit** (`requestSignIn`) shows while signed out; **Invite a friend** (signed in) copies the invite link (`clipboard.writeText`) and confirms with a toast (the link is shown if copying fails). The profile screen shows the account nickname (read-only) or, offline, an editable display name (16 characters, kept in the save).
- **Save.** Progress (lessons, journey stars and bests, challenge and daily bests, achievements, stats) and the offline name are the game's save (`starhermit:storage saves`, `{ v: 1, progress, profileName }`), on the device and in the account. A conflict (another device saved) merges both with `BLStore.mergeProgress` (higher stars and bests, every lesson, earliest unlock of each achievement, larger stats; this device keeps its name). The browser build's cloud save (`game:<slug>`, the SDK's checksummed `{ sum, payload }` document) shows as a foreign save: its progress is merged in and it is replaced once (`replaceForeign`); its game settings are kept where the account has none. Guests' old browser `localStorage` progress does not migrate.
- **Settings.** The game's own settings (captions, desk theme, player colours, left-handed, confirm moves, button board, haptics) are runtime settings `game.<key>`, synced with the account; the browser build's per-player settings keys are imported once where still meaningful and removed. Volumes, mute, graphics, language, reduced motion, contrast and text size are the runtime's Options (Settings → **More options…** opens them).
- **Leaderboards.** Every finished ranked, unassisted sheet (journey, challenge, daily; not practice or lessons) is added to the device's score list (`boxesandlines.leaderboards.v1`, top 100). Signed in, its total goes to the `high-score` board: a practice session's socket carries `{ type: 'result', scores: { 'high-score': total } }` to `score-script.js` (integer, 0–100,000), and the results dialog shows "Posting score to the leaderboard…", then "Leaderboard rank: #N" / "Score posted to the leaderboard." / "Score not posted to the leaderboard.". The Scores screen shows the device list (Global) and, signed in, the platform board (Platform: top 20, nicknames, own row "You (name)").
- **Controls.** 13 actions with keyboard and gamepad defaults, rebindable in the runtime's Options.
- **Daily date.** The device's UTC date (no server-time API is used).

Not used: presence, platform-side achievements (achievements are local), matchmaking, session invites, chat, replays, avatars, `server.js`'s session and score routes.

## 13. Technical architecture

- **Module boundaries.** `rng`, `rules`, `content`, `session`, `store`, `strings`, `i18n`, `migrate` are UMD scripts shared verbatim by the engine client (`loadClassic`, `native/classic.ts`), `server.js` and the Node tests. `native/main.ts` owns state and flow; `screens.ts` draws it every frame (immediate mode); `render.ts` only reads rules snapshots.
- **Determinism and replay.** `session.envelope()` = `{v, contentVersion, cfg, seed, commands, finalHash, result}`; `session.replay(env)` recomputes the hash and returns `null` if any AI command differs from what `aiMove` produces. The server's score endpoint runs the same check.
- **Timing.** The runtime's fixed steps at 60 Hz: AI reply 27 steps, session tick 15 steps (250 ms), all only while the sheet is active; toasts, captions and the hint flash run on `frame().time`.
- **Persistence.** The save (see §12); the device score list and nothing else in device storage.
- **Performance.** Board meshes are rebuilt only on a new sheet, a theme / palette change or a graphics-level change; bursts are pooled (48), confetti is one 260-point cloud, dust one 48-point cloud; textures are canvas-painted once per sheet at the level's size.

## 14. Testing and acceptance criteria

`npm test` = `npm run test:unit` + `npm run test:native`.

- `test:unit`: `node tests/run.js` (39 tests: 16 rules, 10 session, 6 content, 7 store — including the save conflict merge), `node tests/server.test.mjs` (8 API checks on a real `server.js`), `node --test tests/i18n.test.mjs tests/migrate.test.mjs` (every used key translated with its placeholders, locale matching; the browser build's cloud save read, settings carried or dropped, engine save round trip and merge).
- `test:native` (`tests/native.mjs`): the web index matches the files (`npm run package` ran last), `tsc` over `native/*.ts` with the generated `.starhermit/starhermit.d.ts`, `starhermit check .` with no warning, and the play scripts in `tests/native/` (`--render-check --guest`), written by `tools/gen-play.mjs` from the rules: **journey-stage** (title → Play card by Enter → stage 1 played to Results by Home + Enter, with Pip's seeded replies → Title), **learn-lessons** (Learn by Tab → lesson 1 → Next → lesson 2 → Escape to the title), **practice-pause** (Practice by Tab → Study 4×4 → a line → undo → pause → Settings toggle → Back → Help → Back → Resume → hint → Pause → Leave sheet → Scores and Profile by Tab).
- `npm run test:browser` (`tools/browser-play.mjs`, one headless Chrome at a time): the packaged loader on loopback at 1366×768 (keyboard play and pause), 390×844 touch (Play card, a tap on the sheet, the thumb tray's Pause) and 844×390 (a scene tap draws an edge); any console error or warning or the runtime's error screen fails it. `node ../tools/engine-web-smoke.mjs .` is the shared start check.

QA bar (checkable): every screen control is reachable by pointer, touch, keyboard and pad; no console errors or warnings; nothing in the HUD, button board, pause dialog or results is clipped in portrait or landscape; the first stage teaches the extra-turn rule through the preview line and intro toast; a player can always return to the title.

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `coverart.png` (1200×675) | Platform cover: lamplit desk, stamped paper boxes, pencil, bell | FLUX.2 klein, seed 8080, 1536×864 → Lanczos 1200×675, 256-colour dithered PNG (388 KB) | generated in this pass (replaces the placeholder "Puzzle Expedition" card) |
| `assets/title-art.webp` (1024×576) | Key art at the top of the title dialog | FLUX.2 klein, seed 7101, WebP q82 (35 KB) | wired (`screens.ts art`) |
| `assets/results-art.webp` (640×640) | Victory vignette on winning results | FLUX.2 klein, seed 9105, WebP q82 (30 KB) | generated in this pass, wired |
| `icon.png` (256×256), `favicon.svg` | Platform icon, tab icon | authored earlier | shipped |
| `sfx/*.opus` × 17 (see §9) | Original cue set | MOSS-SoundEffect v2 | shipped |
| `sfx/chain-flurry.opus`, `sfx/page-turn.opus`, `sfx/pencil-down.opus` | `chain`, `page`, `pause` cues | MOSS-SoundEffect v2, 100 steps | generated in this pass, wired |
| Desk, paper, dots, edges, folding boxes, stamps, seat tokens, particles | 3D scene | procedural in `native/render.ts` | shipped |
| 3D hero model / character animation | — | not called for: the folding box is procedural and deterministic; there is no humanoid | n/a |

## 16. Known limitations

- On the web runtime, package images in `starhermit:ui` (the title and results key art) may not draw in games that also render a scene (an engine issue reported with the bearing-board port); natively they do. The art widget keeps a paper-coloured fallback.
- `hover`, `select` and `turn` cues have clips but are not played.
- The Scores screen lists the device board (plus the platform board when signed in); scores are never server-verified.
- The daily date comes from the device clock.
- Edge buttons on the button board are 16 px thick by an 18–40 px cell, under the 44 px guideline; the scene and the focus ring are the larger targets.
- Cues are silent until their clip has loaded (no synthesized stand-ins).
- `STREAM_AV` seeded audio variants are unused.

## Design intent not yet implemented

- Play `hover` on pointer-over of a free edge (throttled), `select` on mode-card confirmation and `turn` when the pencil passes to the human.
- Play against another person via platform sessions, with presence and invitations.

