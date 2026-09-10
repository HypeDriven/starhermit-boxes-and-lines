# Boxes & Lines — running game design document

**Status:** shipped; this document describes the game as it runs today (present tense). Behaviour that the design wants but the code does not do yet is confined to the final section, "Design intent not yet implemented".

## 1. Overview

**Pitch.** Dots-and-boxes on a lamplit graph-paper desk: draw one edge between two dots, close the fourth side of a box and it folds up out of the paper in your colour — and you draw again.

| | |
|---|---|
| Genre | Turn-based territory strategy (pencil-and-paper classic, single sheet) |
| Players | 1 human vs 1–3 AI rivals locally; 1 human vs 1 server-run AI in Hosted play |
| Session length | 2×3 lesson sheets ≈ 1 min; 4×4 ≈ 3–5 min; 7×7 journey finale ≈ 10 min |
| Platforms | Desktop and mobile browsers (portrait and landscape); WebGL optional |
| Rendering | Three.js r160 (vendored) scene of desk, paper, dots, edges and folding boxes, with a semantic HTML "button board" mirror that is always on screen and fully playable on its own |
| Networking | Optional Node server (`server.js`) for hosted sessions, verified scores and clock sync; every local mode works offline |

File map (everything that ships or tests the game):

| Path | Responsibility |
|---|---|
| `index.html` | Entry point; loads `css/style.css`, the plain-script modules in order, then `js/main.js` as an ES module |
| `css/style.css` | The only stylesheet: design tokens, HUD, overlays, button board, responsive and accessibility modes |
| `js/rng.js` | mulberry32 PRNG, FNV-1a string hash, three derived streams (rules / decor / av) from one master seed |
| `js/rules.js` | Pure rules engine: board model, legality, `applyCommand`, AI, hint, outcome, score breakdown, serialization, state hash |
| `js/content.js` | Versioned content: player styles, desk themes, 40 journey stages, 6 challenges, 3 practice presets, daily generator, 5 lessons |
| `js/session.js` | Local session: validated command log, undo checkpoints, hints, elapsed clock / time limit, replay envelope |
| `js/store.js` | Checksummed save document in `localStorage`, local leaderboard, achievement catalogue |
| `js/audio.js` | WebAudio: four buses, synthesized cues, lazily fetched `sfx/*.opus` samples, room ambience, generative pad, captions hook |
| `js/ui.js` | DOM builders for every dialog screen (title, practice, journey, challenge, learn, results, settings, help, profile, scores) |
| `js/main.js` | Orchestrator: shell DOM, screen state machine, game flow, AI pacing, timers, input (pointer, keyboard, gamepad), button board, progression, hosted play |
| `js/render.js` | Three.js renderer: procedural desk/paper textures, edges, folding boxes, preview ghost, focus ring, turn tokens, particles, camera, picking |
| `server.js` | StarHermit game script + static host: `/api/v1/time`, hosted sessions, authoritative score replay, per-board leaderboards |
| `vendor/three.module.min.js` | Three.js r160 |
| `sfx/` | 20 Opus clips, `manifest.txt` (canonical binding table), `manifest.json` (generator entries), `manifest.md` (generator report) |
| `assets/title-art.webp`, `assets/results-art.webp` | Key art shown on the title dialog and on a winning results dialog |
| `coverart.png`, `icon.png`, `favicon.svg` | Platform cover (1200×675), icon, tab icon |
| `starhermit.txt` | Platform manifest: `name`, `launch`, `owner`, `server`, `cover` |
| `tests/run.js`, `tests/*.test.js`, `tests/server.test.mjs`, `tests/e2e.mjs` | Unit runner, rules/session/content/store suites, server API suite, Playwright playthrough |
| `tools/validate-content.js`, `tools/smoke-browser.cjs` | Dev-only content validator (used by `content.test.js`) and browser smoke helper; never served |

## 2. Vision and design pillars

1. **The paper is the game.** Every rule is visible on the sheet: undrawn edges are faint, drawn edges carry their author's colour, a claimed box physically folds up and takes a shape stamp. Rules in: state that can be read from the board alone; a DOM board that mirrors the 3D one exactly. Rules out: hidden modifiers, off-board resources, any information the sheet does not show.
2. **The third side is the drama.** The whole tension of dots-and-boxes is deciding who has to open a box first. The game makes that moment legible before commitment (green/amber/white preview ghost, "Risky: gives away a box" HUD line, `pencil-press` cue on a giveaway) and rewards the pay-off (extra turn cue, chain flurry at three boxes, Chain Reaction achievement). Rules out: AI that ignores the third side above easy, hints that do anything other than what the hard AI would do.
3. **Determinism you can audit.** Every match is a seed plus an ordered command list. AI moves come from the rules RNG stream, so a replay reproduces the rival's exact play and the server can refuse forged scores. Rules in: seeded prefill, seeded daily, `hashState`, replay envelopes. Rules out: `Math.random()` anywhere in rules or AI; hints that consume the stream.
4. **Never trapped by the pretty layer.** The 3D scene is cosmetic. If WebGL is missing, fails, or the tab is on a slow phone, the button board, keyboard and gamepad paths play the identical game, and every renderer call is wrapped so a rendering fault cannot stop play. Rules out: any action that exists only in the canvas.
5. **Short warm sessions.** One tap from the title starts the next journey stage; a results dialog explains the score in four integer lines; the desk lamp, paper sounds and unhurried pad keep the mood of an evening at a desk rather than an arcade. Rules out: timers on non-timed sheets, streak-shaming, monetised boosts.

## 3. Player experience

**Target player.** Someone who knows the pencil-and-paper game (or learns it in five one-minute lessons) and wants a calm, tactile, offline-friendly version with a real AI curve and something to chase (stars, dailies, six achievements).

**First 60 seconds.** The title dialog opens on load. Its primary card is `▶ Play — Journey 1 — First Lines` (`ui.js buildTitle` picks the first stage without a star). Tapping it starts a 2×3 sheet against Pip (random AI) and toasts the stage intro: "Draw one edge between two dots. Close all four sides of a box to claim it — and draw again." The HUD objective reads "Claim the most boxes", the sub-line "Your turn — pick an edge". Hovering or focusing an edge previews its consequence (Safe line / Risky: gives away a box / Claims a box — draw again!), so the extra-turn rule is taught by the first claim. The Hint button is enabled on every journey stage. Players who want explicit lessons pick **Learn** on the title: five sheets that each require the rule to be performed (`content.js tutorialLessons`). Help (title link or pause) has six cards including the full control list.

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

**Journey stars** (`main.js finishGame`): win = 1 star, +1 if margin ≥ `starMargin` (1–5 per stage), +1 if elapsed ≤ par. A stage unlocks when the previous stage has at least one star (`ui.js buildJourney`).

**Tie-breaks.** On the sheet: equal top scores are a tie (`winner -1`, "A tie!" headline). On leaderboards (`store.js sortEntries`, `server.js sortEntries`): score desc, then fewer invalid actions, then lower duration, then session id.

**RNG and seeding** (`js/rng.js`). One uint32 master seed per config; `derive(seed, STREAM_RULES)` feeds prefill and AI, `STREAM_DECOR` feeds the daily generator, `STREAM_AV` is reserved for audio variants. The rules stream position is stored in `state.rng`, so `aiMove` is reproducible from state alone. `hashState` is FNV-1a over a key-sorted JSON of the state minus `events`.

**AI** (`aiMove`). Easy: uniform random legal edge. Medium: take the edge with the most claims, else a random safe edge (no third side given), else a random risky edge. Hard: as medium, but when forced to give, opens the smallest chain by `chainOffer` (flood-fill of boxes the opponent could take after the edge). Pip / Margot / Vega are the easy / medium / hard names. **Hint** (`suggest`) is the hard search with the stream position restored afterwards; using it sets `session.assists`, which excludes the result from ranked leaderboards.

**Undo** (`session.js checkpoint/undo`). Only when `cfg.mechanics.undo` (practice presets and lessons). A checkpoint is taken before each human move, so one undo rewinds the human move and every AI reply after it; the stack is capped at 200.

**Clock.** `main.js` ticks the session every 250 ms while the game is active, unpaused and the tab visible. With `timeLimitSec`, reaching the limit applies `timeout` → `time-up`; the winner is still whoever has more boxes, headline "Time!".

## 5. Modes and progression

| Mode | Entry | Config | Ranked | Undo / Hint |
|---|---|---|---|---|
| Journey | title card / ▶ Play | 40 authored stages `j01`–`j40` (2×3 → 7×7; Pip → Margot → Vega; 2–4 pencils; prefilled ink from stage 3; clocks from stage 10; every fifth stage is a MASTERY stage with a margin target) | yes | no / yes |
| Daily Sheet | title card | `dailyConfig(utcDate)`: seed = hash of `boxes-and-lines:daily:YYYY-MM-DD`; board from {3×3, 4×4, 4×5, 5×5, 5×6}; random AI level; 35 % chance of a clock (≥ 90 s, 12 s per box); 40 % chance of 2–6 pre-inked edges; one of the three always-unlocked themes. Replayable; best score kept; countdown to the next UTC day on the card | yes | no / yes |
| Practice | title card → Practice | Sketch 3×3 / Study 4×4 / Master Sheet 6×6, rival level, fresh random seed | no | yes / yes |
| Challenge | title card → Challenge | Sixty-Second Desk (3×3, 60 s clock), The Long Sheet (6×7), Head Start (Margot opens, 6 inked lines), Four Pencils (three rivals), First to Five (race to 5 boxes, hard AI), Surveyor's Exam (4×4 vs Vega, no hints) | yes | no / per challenge |
| Learn | title card → Learn | L1 draw two lines; L2 close a prepared box; L3 claim two boxes in one turn; L4 draw three safe lines; L5 full 3×3 vs Pip. Goals match rules events (`draw`, `box`, `draw-safe`, `over`) | no | yes / yes |
| Hosted | title card → Hosted | 4×4 vs a server-run rival (level chosen on the form); server is the referee; rejoin offered after reload | no | no / no |

Difficulty curve: sheet area grows 6 → 49 boxes; rival level steps at stages 5 (Margot) and 15 (Vega); the number of pencils rises to 3 at stage 6 and 4 at stage 19; clocks appear at 10, 17, 20, 23, 30, 34, 38, 40; star margins rise from 1 to 5.

Unlocks: desk themes Midnight Studio at 15 total stars and Rosewood Parlour at 40 (`content.js THEMES`, checked by `main.js themeFor`); journey stages gate on the previous star. Achievements (`store.js ACHIEVEMENTS`): First Box, First Victory, Chain Reaction (3+ boxes in one turn), Ten Sheets In, Daily Habit (three dailies), Five Hundred (500 boxes lifetime). Stats tracked: rounds, wins, boxes claimed, best chain, play time, daily streak.

## 6. Controls and interaction

| Input | Action | Feedback |
|---|---|---|
| Tap/click an edge in the 3D scene (invisible hit strips 0.32 units wide) | Draw it | Pencil burst at the edge, `draw`/`danger` cue, HUD turn line |
| Hover an edge (pointer) or focus one (keys/pad) | Preview | Ghost strip: green `#6fd98a` safe, amber `#e8a13f` risky, white claim; HUD sub-line names the consequence |
| Drag > 6 px on the scene | Orbit the camera slightly (clamped ±0.8 units) | No draw is committed |
| Tap an edge button on the button board | Draw it | Same as scene tap; button becomes solid in the player's colour |
| Arrow keys | Move the focus ring to the nearest legal edge in that direction (`moveFocus`) | Amber outline in scene and on the board; edge is announced |
| Home / End | Focus first / last legal edge | |
| Enter / Space | Draw the focused edge | |
| U / H / S / C | Undo / Hint / Skip animations / Reset camera | `undo`, `hint`, `ui` cues |
| P or Escape (no dialog open) | Pause / resume | Pause overlay, `pause` cue |
| Escape (dialog open) | Back, same as the ← Back button | `page` cue on the screen that opens |
| Gamepad stick / d-pad, A, B, Start | Move focus, draw, cancel armed edge, pause | Same as keyboard |
| Confirm-moves setting | First tap arms the edge and shows the preview, second tap commits | Toast "Tap again to confirm" |

Input locking: `onPick` ignores input unless a session is active, unpaused and it is a human turn; out-of-turn taps play `invalid`. AI replies are scheduled 450 ms after the state changes (`scheduleAiIfNeeded`) and cancelled by any pause, undo or teardown. Animations never block input — logical state is ready immediately and Skip settles the folds. Haptics: 15 ms vibration on each own box claim when enabled.

## 7. Screens and UI flow

`main.js` keeps `appState`: `boot → title → mode-select → preparing → active ↔ paused → resolving → results → progression`. Dialog screens are one `#screen-overlay` panel (`role=dialog`, `aria-modal`) whose body is rebuilt by `showScreen(name)`: title, practice, journey, challenge, learn, settings, help, profile, scores, results, hosted. While any overlay is open the shell is `inert`. The ← Back button (and Escape) is hidden on the title when no sheet is in play, so a finished sheet can never strand the player.

Layout: `#app-shell` is a column grid: `#topbar` (objective block, status block with turn indicator / score chips / clock, actions block with Hint · Undo · Skip · Pause) above `#play-region`, which stacks `#scene-host` (3D canvas, `role=application`) over `#board-mirror` (the button board). Padding on the shell and overlays adds the four `env(safe-area-inset-*)` values.

- **Desktop (≥ 1024 px).** Three HUD blocks in one row; the panel is `min(680px, 92vw)` wide, `max-height 88dvh`, scrollable inside.
- **Compact (< 1024 px).** Objective spans the top row; status and actions share the second.
- **Portrait phone (≤ 700 px).** Status stacks above objective; HUD buttons grow to 48 px and share the row; the board mirror keeps a 12 px dot grid with edge buttons `minmax(30px, 1fr)`.
- **Short landscape (height ≤ 500 px).** Objective sub-line hidden, buttons 44 px, and the button board moves beside the scene (`grid-template-columns: minmax(0,1fr) auto`).

Never cut off: the four HUD buttons, the score chips, the whole button board, the Resume button on pause, and the Retry / Next / Title row on results (the panel scrolls before anything is clipped). Toasts sit `24px + safe-bottom` above the bottom edge; captions sit bottom-left (bottom-right in left-handed layout).

## 8. Art direction

**Hero.** The sheet of graph paper under lamplight, and the moment a box folds up out of it and takes its stamp (`render.js makeFoldBox`, four flaps hinged on the cell edges, `FOLD_TIME` 0.55 s, stamp pops in over the last 65 % of the fold).

**Palette** (CSS tokens in `style.css`): desk `#241b12` / `#2e2318`, paper `#f2ead8` / `#e9dfc8`, paper edge `#d8cbae`, ink `#2a211b`, ink-soft `#5c4f41`, ink-faint `#8a7a66`, amber `#e8a33f` (focus, primary buttons, active chip), amber-deep `#c9821e`, ruled lines `#cfc0a3`, good `#4e7d4e`, bad `#a8463a`. Players (colour always paired with a stamp shape and a name): You ● `#3f8efc`, Rival ▲ `#ef5d4e`, Third ■ `#e8b23f`, Fourth ◆ `#5fbf77`; high-visibility set `#2e6fe4 / #e4572e / #f5d90a / #17a398`. High-contrast mode swaps the desk to `#100b06`, paper to `#fdf6e6`, ink to `#171008` and thickens borders.

Desk themes (`content.js THEMES`, 3D palette as hex ints): Graph Paper Desk (desk `6e4a2e`, paper `f2ead8`, grid `9db4c8`, dot `4a4038`, wall `3a2e26`, light `ffd9a8`, fog `2a211b`), Blueprint Table (`2e3a4a` / `27435e` / `7fa8c8` / `d8e4ee`), Kraft Workshop (`7a5a38` / `d8bd8f` / `a8895e` / `4a3520`), Midnight Studio (`2a2530` / `322d3e` / `6a6080` / `c8c0d8`, 15 ★), Rosewood Parlour (`5a2e2e` / `ead8c8` / `b08a80` / `3e2828`, 40 ★). Journey stages carry a theme; the settings theme applies elsewhere.

**Shape language.** Rounded paper cards (10–12 px radii) with soft drop shadows on a dark wood ground; dashed outlines for undrawn edges, solid colour bars for drawn ones; circle / triangle / square / diamond stamps; round "seat" tokens on each side of the sheet that brighten for the player to move.

**Typography.** System sans stack (`-apple-system, Segoe UI, Roboto, …`), 16 px base, 1.45 line height, 1.8 rem dialog titles; Larger text setting scales the root to 118 %. Tabular numerals on clocks and chips.

**Motion.** Camera FOV 40 with a 14 s idle drift of 0.12 units, 0.8 s eased reset, a rise-and-confetti flourish on game over (`startCamRise`, pooled ≤ 260 paper chips), pencil bursts on every draw. Quality tiers (`render.js QUALITY`): low = DPR 1, no shadows, 80 particles; medium = DPR 1.5, 1024 shadow map, 160; high = DPR 2, 2048, 300; Auto picks low on ≤ 4 cores, high on DPR ≥ 2 with a ≥ 1024 px screen. **Reduced motion** (setting or OS preference): folds take 0.15 s, every event animation is capped at 0.3 s, no drift, camera rise or confetti, CSS transitions collapse to 0.01 ms, hover lifts are removed.

**Visual assets the design calls for:** title key art (a lamplit desk with stamped paper boxes) above the mode cards; a victory vignette (one folded box, bell, confetti) on winning results; a cover in the same still-life language; the icon and favicon. See §15 for status.

## 9. Audio direction

**Philosophy.** Everything is something you could hear at a desk: graphite, paper, wood, a brass bell, an old clock. No synth stingers as the primary voice — synthesis exists only as the fallback while a clip loads or if it 404s. Cues are short (≤ 3 s) and never stack on the music.

**Buses** (`audio.js`): `music` 0.55, `effects` 0.9, `ambience` 0.5, `voice` 0.8 (reserved, unused), master mute. Settings sliders map straight onto bus gains. Ambience is a looped brown-noise room tone through a 320 Hz low-pass at 0.16 gain; music is a generative sine pad on a G3 pentatonic set, 3.2 s swells every ~2.6 s. The context starts on the first pointer/key/touch gesture, suspends when the tab hides and resumes on return. Captions (setting) push each cue's text into `#captions` for 1.5 s.

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
| hover / select / turn | pencil-hover / menu-select / turn-tap.opus | faint tip tick / page turn with press / quiet pencil tick | bound in `audio.js`, not yet triggered by `main.js` |

## 10. Localization

The game currently ships **en-US only**. All player-facing strings are literals in `js/ui.js` (screens), `js/main.js` (HUD, toasts, announcements, invalid-move text), `js/content.js` (stage names, intros, goal text, rival names) and `js/store.js` (achievement names). There is no locale table and no language selector; `index.html` declares `lang="en"`. Layout already tolerates ~30 % string growth (cards wrap, the panel scrolls, HUD buttons wrap). The required language set — en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT — is listed under "Design intent not yet implemented".

## 11. Accessibility

- **Keyboard-only path.** Title cards and every dialog control are native buttons/inputs in tab order; the board is playable with arrows + Enter, or by tabbing through the button board's edge buttons (each labelled "horizontal/vertical edge row r column c", with ", drawn by Name" or ", pre-drawn" once taken and `disabled`). Focus returns to the previously focused element when a dialog closes.
- **Focus.** 3 px amber outline (`:focus-visible`), plus a matching focus ring mesh in the scene; the hint pulses the suggested button for 1.6 s.
- **Screen reader.** A polite live region announces stage start and objective, turn changes, hints ("Hint: try the vertical edge row 2 column 1"), undo, pause/resume, lesson completion and the final score line. The scene host is `role=application`; key art is `alt=""`/`aria-hidden`.
- **Captions** for sound cues (setting), rendered bottom-left.
- **Contrast and colour.** Paper-on-dark palette; High contrast mode; player colour is always doubled by a shape stamp and a name; a high-visibility player palette exists for colour-vision deficiency.
- **Motion.** Reduced motion setting and `prefers-reduced-motion` both honoured (see §8).
- **Targets.** HUD buttons ≥ 44 px (48 px on portrait phones); mode cards and level rows ≥ 44 px tall; edge buttons are ≥ 28 px with 4 px gaps and grow with available width.
- **Other.** Larger text (118 %), left-handed HUD order, confirm-moves (two-tap commit), haptics toggle, and a text fallback when WebGL is unavailable.

## 12. StarHermit integration

`starhermit.txt` declares `name=Boxes & Lines`, `launch=index.html`, `owner=<uuid>`, `server=server.js`, `cover=coverart.png`, following the manifest conventions at https://wiki.starhermit.com/.

Used:
- **Server script** (`server.js`, zero dependencies, `PORT` env or `--port`): serves the static files (refusing dotfiles, non-whitelisted types, and anything under `tests/`, `tools/` or `node_modules/`), and exposes `/api/v1/time` (clock sync used for the daily date and countdown), `/api/v1/sessions` (+ `/:id`, `/:id/moves`, `/:id/resign`) for Hosted play, and `/api/v1/scores` (POST re-creates the game from `cfg`, replays every command, re-derives AI moves from the seed, and rejects `impossible-score` / `stale-version`; GET returns a board's top 50). Per-IP rate limit 120 requests/min; sessions expire after 2 h idle; boards keep 500 entries.
- **Sessions / reconnect:** hosted sessions are authoritative and idempotent per `cmdId`; the client stores a marker in `sessionStorage` and offers "Rejoin hosted sheet?" after a reload.
- **Leaderboards:** every ranked, unassisted finish is stored locally and POSTed for verification. Offline play is normal — a failed POST is silently ignored.

Not used: platform identity (display name is a local profile field, default "Guest"), presence, platform-side achievements (achievements are local), human-vs-human matchmaking or invitations. The Scores screen shows the local board only.

## 13. Technical architecture

- **Module boundaries.** `rng`, `rules`, `content`, `session`, `store` are UMD modules shared verbatim by the browser and Node (server and tests). `audio`, `ui` are browser globals; `main.js` is the only ES module and the only importer of `render.js`, so the renderer can fail without the game failing (`rCall` wraps every renderer call in try/catch).
- **Determinism and replay.** `session.envelope()` = `{v, contentVersion, cfg, seed, commands, finalHash, result}`; `session.replay(env)` recomputes the hash and returns `null` if any AI command differs from what `aiMove` produces at that point. The server's score endpoint runs the same check.
- **Persistence.** `localStorage['boxesandlines.save.v1']` holds `{sum, payload}` where `sum` is FNV-1a of the payload; a mismatch or a future version yields a fresh document rather than a crash; a memory fallback covers private mode. Leaderboard cache: `boxesandlines.leaderboards.v1` (top 100). Hosted marker: `sessionStorage['bl.hosted']`.
- **Timing.** AI reply delay 450 ms; session tick 250 ms; countdown refresh 1 s; gamepad poll 100 ms; all timers stop on pause, tab hide (which auto-pauses local play) and teardown.
- **Performance budget.** Board meshes are rebuilt only on `setBoard`; particles and confetti are pooled (`MAX_BURSTS` 48, `MAX_CONFETTI` 260); textures are procedural canvases sized per theme; DPR capped per tier; shadow maps disabled on low tier; WebGL context loss is handled by rebuilding textures. Shipped images total < 500 KB; Opus clips are 1–3 s mono at 96 kbps.
- **E2E driving.** `tests/e2e.mjs` starts its own static server (answering `/api/*` with 404 to exercise the offline path), launches Chrome via `playwright-core`, and plays only through visible UI: it reads the button board's `aria-label`s to choose competent edges, clicks HUD buttons, presses real keys, and checks the DOM after each step.

## 14. Testing and acceptance criteria

`npm test` = `node tests/run.js` (37 unit tests: 16 rules, 10 session, 6 content, 5 store) then `node tests/server.test.mjs` (8 API checks on a real `server.js` on an ephemeral port). Covered properties: board shapes and holes; prefill never completes a box; claim/extra-turn/pass ordering; two-box claims; terminal reasons and tie detection; invalid commands leave state untouched; AI determinism from `state.rng`; hint does not consume the stream; score breakdown; serialize/deserialize; undo cascade; duplicate command ids; replay envelope round-trip; content validator (unique ids, themes, daily immutability); save checksum, corruption and migration; hosted create → move → reconnect → resign; an honest playthrough posts a verified score; a fabricated log where the rival plays to lose is rejected; stale versions rejected; dotfiles not served.

`npm run test:e2e` (needs `/usr/bin/google-chrome`) runs the same playthrough at 1280×800 and at 390×844 with touch: title with ≥ 6 cards → journey stage 1 → hint highlights an edge → arrows + Enter draw → pause/resume → sheet played to Results via the button board (all 17 edges) → breakdown rows and persisted save → Back returns to a usable title (regression) → practice sheet with undo → settings from pause (High contrast applies; Escape closes only the dialog) → leave sheet → lesson 1 to "Lesson complete" → settings from title. Any console error or page error fails the pass.

QA bar (checkable): every mode card and dialog control is reachable by mouse, touch and keyboard; no console errors or warnings at either viewport; nothing in the HUD, button board, pause or results panel is clipped in portrait or landscape; the first stage teaches the extra-turn rule through the preview line and intro toast without reading Help; a player can always return to the title from any state.

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `coverart.png` (1200×675) | Platform cover: lamplit desk, stamped paper boxes, pencil, bell | FLUX.2 klein, seed 8080, 1536×864 → Lanczos 1200×675, 256-colour dithered PNG (388 KB) | generated in this pass (replaces the placeholder "Puzzle Expedition" card) |
| `assets/title-art.webp` (1024×576) | Key art at the top of the title dialog | FLUX.2 klein, seed 7101, WebP q82 (35 KB) | generated in this pass, wired (`main.js prependArt`) |
| `assets/results-art.webp` (640×640) | Victory vignette on winning results | FLUX.2 klein, seed 9105, WebP q82 (30 KB) | generated in this pass, wired |
| `icon.png` (256×256), `favicon.svg` | Platform icon, tab icon | authored earlier | shipped |
| `sfx/*.opus` × 17 (see §9) | Original cue set | MOSS-SoundEffect v2 | shipped |
| `sfx/chain-flurry.opus`, `sfx/page-turn.opus`, `sfx/pencil-down.opus` | `chain`, `page`, `pause` cues | MOSS-SoundEffect v2, 100 steps | generated in this pass, wired with synth fallbacks |
| Desk, paper, dots, edges, folding boxes, stamps, seat tokens, particles | 3D scene | procedural in `render.js` | shipped |
| 3D hero model / character animation | — | not called for: the folding box is procedural and deterministic; there is no humanoid | n/a |

## 16. Known limitations

- No localization: English only, strings inline (see §10).
- The "Always show button board" setting toggles a `mirror-emphasis` body class that has no stylesheet rule; the button board is always visible regardless.
- `hover`, `select` and `turn` cues are defined and have clips but `main.js` never plays them.
- The Scores screen lists only the local board; the client never reads `GET /api/v1/scores`, so server-verified ranks are not displayed.
- Without the server, the daily date comes from the device clock.
- Hosted play supports one human vs one server AI only; the server accepts a `timeLimitSec` the client never sends or enforces, and the rejoin form always labels the rival "Rival" at medium regardless of the level originally chosen (state, scores and moves are still exact).
- Edge buttons on the button board are 28–30 px minimum, under the 44 px guideline; the 3D hit strips and keyboard path are the larger targets.
- `tests/e2e.mjs` hard-codes `/usr/bin/google-chrome`.
- The `voice` bus and `STREAM_AV` seeded audio variants are wired but unused.

## Design intent not yet implemented

- Localized string tables and a language selector for en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT, chosen from `navigator.languages` with a settings override.
- Play `hover` on pointer-over of a free edge (throttled), `select` on mode-card confirmation and `turn` when the pencil passes to the human.
- A stylesheet rule for `mirror-emphasis` that enlarges the button board and shrinks the scene.
- Fetch and show the server-verified board per journey/challenge/daily id on the Scores screen alongside the local one.
- Hosted play against another person via platform sessions, with presence and invitations.
