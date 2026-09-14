# Speed AI — Reading Trainer

RSVP speed-reading trainer with adaptive pacing, comprehension quizzes, neuro-drills,
and AI passage generation that runs on a local model (Ollama), Gemini, or any
assistant via copy/paste.

## Running it

Double-click **`Start Speed Reading.cmd`** (Windows) or run
**`./start-speed-reading.sh`** (macOS/Linux). It installs dependencies on first
run, builds, and opens your browser. Keep the window open while you train;
closing it stops the server.

Equivalent from a terminal:

```
npm start
```

For development with hot reload instead:

```
npm install
npm run dev
```

## AI features: three paths, no dead ends

Passage generation, speed-push drills, question checking and the coaching
diagnostic can run any of three ways, chosen under **Settings → AI Features**:

1. **Local model (default)** — a model on your own [Ollama](https://ollama.com)
   server (`http://127.0.0.1:11434`). No key, nothing leaves the machine. The app
   lists your installed models and picks one automatically (`sol-fast`, then
   `gpt-oss:20b`, then `gemma4`), or you choose. If Ollama isn't running, the
   features fall back to copy/paste and say why.
2. **Gemini API** — set `VITE_GEMINI_API_KEY` in `.env`. The only path that can do
   the Video Summary directly, since that needs web search.
3. **Copy/paste** — each feature shows a panel that hands you the exact prompt to
   paste into ChatGPT, Claude, Gemini, or whatever you already have open, and
   takes the reply back as pasted JSON.

All three share one set of prompt builders and one result handler
(`src/lib/ai.js`), so validation can never drift between them. Which path is in
force is decided once, in `src/lib/aiProvider.js`.

### Local models: what was measured

Run against this app's real prompts on an RX 9070 XT (2026-09-14,
`scripts/eval-ollama.mjs`, which you can rerun with any model names):

| Task | sol-fast (gpt-oss 20B) | gemma4:12b |
|---|---|---|
| Passage + 5 questions | 11s, 5/5 usable | 12s, 5/5 usable |
| Question check | 1s, correctly answered none blind | 1s, guessed (returned an out-of-range index) |
| Speed-push drill | 18s, 5/5 usable | 19s, 5/5 usable |
| Coach report | 11s | 4s |

A first request after the model has been unloaded adds load time (about 10-25s).
In the app a full passage including the question check took 36s end to end.

Thinking models need handling, and `src/lib/ollama.js` does it from the model's
family: gpt-oss gets `think: "low"` (at the default "medium" a push drill took
111s instead of 20s, and `think: false` breaks its JSON), while other thinking
models (gemma4, qwen3) get thinking switched off, which made gemma4 5x faster with
the same quiz quality. Requests use `/api/chat` with the schema passed as
`format`.

Ollama only accepts browser requests from allowed origins. `localhost` and
`127.0.0.1` on any port are allowed by default; serving the app from anywhere
else needs that address in `OLLAMA_ORIGINS`. The pasted-reply
parser tolerates what assistants actually produce: a preamble, code fences, a
trailing sign-off, nested objects, and braces or escaped quotes inside strings.
Failures explain what to fix rather than surfacing a parser error.

The app is fully usable with no API key at all — the baseline test and the
built-in speed-push drill both ship with their own content.

`VITE_GEMINI_MODEL` overrides the model (defaults to `gemini-3-flash-preview`).

> Note: a `VITE_` variable is bundled into the client build, so anyone loading the page
> can read the key. Fine for local use; put the call behind a small server route before
> deploying this anywhere public.

## How the training loop works

Three numbers, deliberately kept separate (they were previously conflated):

| Number | Kind | Where it lives |
|---|---|---|
| **Target WPM** | prescription — what the reader opens at | `userStats.targetWpm`, adapts after each quizzed session |
| **Raw WPM** | measurement — words divided by time actually spent reading | recorded per session |
| **Effective WPM** | measurement — raw x comprehension | derived from history, never stored as a stat |

Your **baseline** is set once, by a built-in 244-word passage read at your
natural pace with no pacing aids, followed by a five-question quiz. It needs no
API key. The measured speed becomes your starting target, and every later
number is reported relative to it.

Settings offers a straight choice for who moves the target: **let the app set
it**, which adapts on your quiz scores, or **set it yourself**, which locks the
number until you change it with the +/- controls. Switching to manual seeds from
wherever adaptation had reached, so the speed never jumps just because you took
over, and the dashboard labels the card `Locked` so a target that never moves
reads as a setting rather than a plateau. Either way sessions are still
recorded, and Effective WPM still reports whether a speed is actually working.

Adaptation is an asymmetric staircase. On the standard five-question quiz:
5/5 climbs 5%, 4/5 holds, 3/5 eases back 3%, 2/5 or worse backs off 8%. The
bands sit above a naive midpoint because four options mean guessing alone
scores ~25%. A session with no comprehension quiz still counts for your streak
but cannot move the target, because nothing about retention was measured.

Quizzes are validated before use: malformed questions are dropped, and options
are shuffled client-side so a model that favours a particular answer position
can't be gamed. Below three usable questions the session is recorded as
unscored practice rather than a bad signal.

With a local model or an API key and **Check questions** enabled, generation runs a second pass:
the model is shown its own questions with no passage and asked which it can
answer from general knowledge alone. Any it gets right are dropped, because a
question answerable without reading inflates your comprehension and pushes your
target speed up on a signal that measured nothing. The check refuses to reduce a
quiz below three questions, and a failed check never blocks the passage you
asked for.

All of this lives in `src/lib/stats.js` and `src/lib/quiz.js` as pure functions.

## Library and retention

Everything you read is saved (`src/lib/library.js`, persisted under
`speedReadLibrary`). Passages can be resumed mid-text, replayed, or re-quizzed.
Leaving part-way stores the resume point; finishing clears it.

Resuming is accounted for honestly: the recorded speed counts only the words
read in that sitting, since the clock only measured the remainder.

**Retention checks** are the point of the library. A quiz taken immediately
after reading measures short-term memory, not comprehension - you can ace a
passage you will have forgotten by Thursday. So completed passages come back on
a widening schedule (2, 7, 21, 60 days) with the questions and no text. These
record against the passage only, never into session history: no reading
happened, so there is no speed to pair a score with.

## The speed-push drill

The highest-leverage thing in the app, in `src/lib/protocol.js` and
`src/components/SpeedPush.jsx`. Four phases:

| Phase | Section | Speed | Scales | Measured |
|---|---|---|---|---|
| Warm-up | A | 1x target | no | no |
| Push | A | 2x target | **yes** | no |
| Blast | A | 3x target | **yes** | no |
| Measured Read | B (unseen) | 1.3x target | no | **yes** |

The over-speed passes exist to recalibrate what "fast" feels like, so the final
read at 1.3x lands easier than it would cold. Only that read is timed and
recorded, and the questions are pinned to section B so a third pass over
section A cannot be mistaken for comprehension.

Drill speeds get their own range (`DRILL_WPM_MIN`/`DRILL_WPM_MAX`, 100-3000),
deliberately wider than the recorded-session clamp, since a 3x blast from a high
target needs headroom above anything you would actually read at.

### Adaptive overload

The two over-speed phases are marked `overload: true` and scale by
`stats.pushIntensity` (0.6-1.6, default 1.0): `phaseMultiplier` returns
`1 + (base - 1) * intensity`, so 1.0 gives the textbook 2x/3x and 1.4 gives
2.4x/3.8x. `nextPushIntensity` moves it after every quizzed push read - +0.05
at 90%+, hold in the 70-89% band, -0.1 at 50-69%, -0.2 below.

Two design constraints are load-bearing here:

- **The measured read never scales.** Its 1.3x is the constant the protocol is
  calibrated against, and the target speed it multiplies is already adapting.
  Letting both move would leave two loops chasing each other and nothing
  comparable from one session to the next.
- **It climbs slower than it falls.** A perfect quiz already raises every
  phase's absolute pace by 5% through `adaptTarget`, so the multiplier and the
  target compound; the half-step up keeps that in hand.

`achievedMultiplier` is what the UI displays, not the requested one - at a high
target the 3000 WPM ceiling holds a blast below its nominal figure, and
announcing 4x while running 2x would be a lie on screen.

Sources: the built-in Broad Street passage (no API key needed), an AI-generated
pair of sections, or any pasted text long enough to split - `splitPassage`
divides on the most balanced paragraph boundary, falling back to sentences.

## Reading modes

- **RSVP** flashes words at one fixed point. Fastest way to experience high
  speed and break subvocalisation, but it trains a skill you can only use in
  this app.
- **Paced** sweeps a cursor across normally laid-out text at the target speed.
  Real saccades, real fixations, so it transfers to reading off a page. This is
  where most training time should go. Line positions are measured from the DOM,
  so the cursor follows real wrapping at any width or font size.
- **Natural** applies no pacing and just times you. Used by the baseline test.

Switching the tab pauses the session: a hidden tab stops animation frames and
throttles timers while wall-clock time keeps running, which would otherwise
record a badly deflated speed.

## On the 2,000 WPM goal

The ceiling is set to 2,000 and the goal tracker will happily aim there, but be
clear about what the number means. Reading every word with full comprehension
tops out around 500-600 WPM for most people - a fixation lasts about 200ms and
takes in roughly 15-18 characters. Past ~700 WPM you are necessarily sampling
text rather than reading it.

Sampling fast is a real and useful skill, just a different one. Effective WPM is
the honest arbiter: push raw speed as hard as you like and watch whether eWPM
keeps climbing or peaks and falls. The Analytics scatter plots exactly where
your own trade-off sits.

## Layout

`App.jsx` holds state and routing and nothing else. Everything with a screen of
its own lives in `src/views`, reusable pieces in `src/components`, and all the
logic worth testing is pure and sits in `src/lib`.

```
src/
  App.jsx              state, persistence, routing
  lib/                 pure logic, each with a .test.js beside it
    stats.js           the three speeds, adaptation, streaks, migrations
    quiz.js            validation, option shuffling, scoring
    protocol.js        speed-push phases, passage splitting
    library.js         saved passages, resume points, recall schedule
    ai.js              prompt builders, reply parsing (every AI path)
    aiProvider.js      which path is in force: local / gemini / copy-paste
    ollama.js          local model transport, schema conversion, thinking control
    gemini.js          Gemini API transport
    calibration.js     built-in baseline passage
    drills.js          built-in speed-push passage
    drillStats.js      drill staircases, thresholds, per-drill direction
    readingStyle.js    typography, themes, CSS variables
    num.js             shared numeric coercion (see below)
    backup.js          export/import of the whole profile
    useHotkeys.js      window-level keyboard shortcuts
  components/          PacedText, Quiz, SpeedPush, ManualAiPanel, ReadingSurface,
                       PassageText, StatCard, NavItem, Toggle
    drills/            SchulteDrill, ChunkFlashDrill
  views/               Dashboard, Library, Reader, Tools, Analytics, AICoach,
                       VideoSummary, SettingsPanel, ReadingEnvironment, Guide,
                       RecallCheck
```

## Scripts

- `npm run dev` — dev server
- `npm run build` — production build to `dist/`
- `npm run preview` — serve the built output
- `npm test` — run the unit suite
- `npm run test:watch` — watch mode
- `npm run lint` — ESLint

## Importing documents

Pick or drop a file in the Library. Supported: `.txt`, `.text`, `.md`,
`.markdown`, `.html`, `.htm`, `.epub`, `.docx`, `.pdf`.

- **EPUB** is read via its spine, so chapters come out in reading order rather
  than whatever order the zip happens to store them in. The title comes from
  the OPF metadata.
- **PDF** text is rebuilt into paragraphs from vertical gaps between text runs,
  since pdf.js returns positioned fragments rather than lines. Scanned PDFs have
  no text layer and will say so rather than importing nothing.
- **HTML** keeps block elements as paragraphs and drops script, style, nav,
  header, footer and aside.
- **DOCX** reads the `w:t` runs out of `word/document.xml`.

Extracted text is normalised with NFKC, which folds the non-breaking spaces and
`fi`/`fl` ligatures that document extraction is full of. Paragraph breaks are
preserved because the reader renders them and the pacer measures lines from them.

The zip and PDF parsers are dynamically imported, so the 1.7&nbsp;MB of pdf.js
only loads if you actually open a PDF — it is a separate chunk, not part of the
initial bundle.

## Your data

Everything lives in `localStorage` for one browser profile, so Settings has an
export/import pair. Export writes a dated JSON file with settings, stats,
session history, the passage library and drill runs. Import previews what the
file contains — when it was exported, how many sessions and passages, the
baseline and target — before replacing anything, and runs every section through
the same migrations used when reading storage, so a partial or hand-edited file
degrades to defaults rather than corrupting the profile.

Back up regularly. Clearing site data is otherwise unrecoverable.

## Keyboard

In the reader, since you read with your eyes fixed and reaching for the mouse
defeats the exercise:

| Key | Action |
|---|---|
| `space` | play / pause |
| `↑` `→` | +25 WPM |
| `↓` `←` | -25 WPM |
| `esc` | exit to the library, saving your place |

Shortcuts are suppressed while typing in a field and during quizzes, where the
answer buttons own the keyboard.

## Training plans

Your own path through the app: an ordered list of drills and reads with your
goals and notes attached. Nothing is prescribed — the app knows how to run each
step and remember which ones you finished, and that is all.

Steps map to things the app can launch (baseline, push drill, a read, any of
the four neuro-drills) plus `note` for rest days and written instructions. Tick
steps off as you go; the plan does not try to drive the app further than sending
you to the right view, which keeps plans loosely coupled to everything else.

**Plans are shareable as Markdown.** Export writes a `.plan.md` file, and
"Copy text" puts the same thing on the clipboard so a plan can be pasted
straight into a message. The format is a title, an optional `> goal`, a
`**Author:**` line, free prose for notes, and a numbered list where each step
names its kind in bold:

```markdown
# First week

> Establish a baseline and get used to every mode.

**Author:** Built in

One sitting a day, about fifteen minutes.

## Steps

1. **Baseline test** — Read at your genuinely normal pace.
2. **Chunk Perception** — Note the number; it is your starting width.
```

The parser is forgiving about everything except the step list: numbered or
bulleted, `- [x]` checkboxes accepted and discarded, the raw kind id (`push`)
accepted in place of the label, unrecognised steps skipped rather than fatal,
and the `## Steps` heading optional. A plan can be written by hand in any
editor, which is the whole point of choosing Markdown over JSON. `parsePlan`
still reads the `.plan.json` files earlier builds wrote.

Progress is deliberately not included — someone else's ticks mean nothing to
you — and an imported plan gets fresh ids so it can never collide with one you
already have. Two starter plans ship as examples to copy and edit.

## Reading setup

Typography is not decoration here. Line width decides how many saccades a line
costs; line height decides whether the return sweep lands on the right line;
contrast decides how long you last. The **Reading Setup** view exposes all of
it with a live preview:

- **Typeface** — three system stacks plus Lexend, Atkinson Hyperlegible and
  OpenDyslexic. The web fonts are only fetched when selected, so the default
  setup works offline and makes no network request.
- **Colour** — dark, warm dark, sepia, light, high contrast; plus the RSVP
  focal-letter colour and whether the centre guide shows.
- **Size** — prose and RSVP sized independently, plus bionic bold strength.
- **Spacing** — line width in `ch` (with a note on whether you are inside the
  comfortable 45-80 band), line height, letter and word spacing, paragraph gap,
  and justification.

Every mode renders inside the same `ReadingSurface`, so RSVP, Paced and Natural
share one set of conditions and a WPM measured in one is comparable with a WPM
measured in another. Values are clamped on read, so a bad stored or imported
value degrades instead of blanking the page.

## Neuro-drills

Four drills, each targeting a different constraint on reading speed. All are
recorded and trended; direction is per drill, so "best" means the maximum for
chunk width and the minimum for the timed ones.

- **Chunk Perception** — a phrase flashes for 320ms, then you pick which one it
  was from near-miss alternatives. The phrase widens by a word each time you are
  right. Words per fixation multiply straight into words per minute, so this is
  the most direct lever on speed of anything here.
- **Schulte Table** — find 1 to 25 in order while holding your gaze on the
  centre square. Widens the area you can attend to without moving your eyes.
  Wrong clicks cost a second.

- **Peripheral Expansion** measures perceptual span with an adaptive staircase.
  Two letters flash at the screen edges; the duration shortens 25% after a hit
  and lengthens 40% after a miss over 8 rounds. Your score is the briefest
  flash you read correctly. This is the limit that stops you reading every word
  much past 600 WPM, so it is the one worth pushing.
- **Target Scanning** measures visual search: seconds to find a word without
  reading the text, with a one-second penalty per wrong click so that clicking
  wildly cannot beat scanning.

Drill results live in their own history and never touch session stats or the
target speed — they measure span and search, not reading. The peripheral drill
abandons a run if the tab loses focus, because background tabs clamp timers to
about a second and a 150ms flash would silently last far longer than the number
being recorded.

## Linting

`npm run lint`. Two rules are errors because both caught real bugs here:
`react-hooks/exhaustive-deps` (stale closures reading old state) and the
jsx-a11y click-handler rules (drill cards were clickable `div`s, unreachable by
keyboard).

The React Compiler rules — `purity`, `refs`, `set-state-in-effect`,
`preserve-manual-memoization` — are warnings. They flag patterns this app
relies on legitimately, such as measuring layout then setting state in a layout
effect. Warnings keep them readable without training anyone to ignore a red
build.

## Tests

The logic that matters is pure and lives under `src/lib`, with a test file
beside each module: adaptation and streaks (`stats`), quiz validation and
shuffling (`quiz`), drill phases and passage splitting (`protocol`), the library
and its recall schedule (`library`), and prompt building plus reply parsing
(`ai`).

Several tests are labelled as regressions and are worth keeping.

Two were caught by the tests rather than by use: `planProgress` could report
over 100% when a step was deleted while its tick remained, and `fromMarkdown`
echoed the step lines back into the notes field whenever a plan had no
`## Steps` heading.

A third came from a rule living in two places. `Library.jsx` knew that a resume
point at the end of the text is not a resume point; the reader did not, so
reading to the end and then leaving the quiz through the sidebar stored the end
of the passage as your position — reopening gave a blank RSVP screen that logged
a zero-word session on the first press of play. The rule now lives once, in
`resumePoint`, and both call sites use it.

The same shape of bug appeared on the dashboard: with adaptation switched off,
the card showed `settings.baseWpm` while "% vs baseline", the goal projection
and the progress bar were all still derived from the frozen `stats.targetWpm`.
`baselineDelta` and `goalProgress` now take the speed actually in force.

A fourth was a units mismatch rather than a duplicated rule. The reading clock
runs for the whole sitting, but each mode counts words on its own basis: Paced
and Natural both restart at the first word, and RSVP counts from its cursor.
Switching modes part-way therefore divided one mode's words by another mode's
seconds — try RSVP for half a minute, decide you prefer Paced, and the session
was logged well below the speed you actually read at, dragging the adaptive
target down with it. A mode change now restarts the measurement.

The typography table had a variant of the same disease: `web: true` sat on the
font option while the stylesheet URL lived in a separate `if` chain, so a font
could be flagged web-loadable with no working source. OpenDyslexic shipped
pointing at a Google Fonts family that does not exist; the request failed
silently and the stack fell through to Comic Sans. Each option now carries its
own `hrefs`, and a test asserts every non-system font has one.

One bug family appeared three times in three modules: `Number(null)`,
`Number('')` and `Number(false)` are all `0`, and `0` passes `Number.isFinite`.
A bare finiteness check therefore turns "missing" into a real value. It invented
a 150 WPM baseline for every new user, scored unread practice at 0%
comprehension, and would have snapped a cleared settings field to its minimum.
It recurred because the coercion was duplicated, so it now lives once in
`src/lib/num.js` and everything else imports it.

---

## License

**Source-available, noncommercial.** Copyright © 2026 Solopass. Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).

- ✅ **Free** for personal use, hobby projects, study and research, and for nonprofits, schools and public institutions.
- 💼 **Commercial use** (in a business, product or paid service, or for-profit internal use) needs a paid license. See [COMMERCIAL.md](COMMERCIAL.md), or contact [realsolopass@gmail.com](mailto:realsolopass@gmail.com) · <https://polymatica.pages.dev>.
