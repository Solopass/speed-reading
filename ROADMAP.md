# Roadmap

Where the app stands and what is worth building next, in priority order.

The goal driving all of this: raise reading speed as far as it will honestly go,
with Effective WPM as the arbiter of what counts as progress.

## Where it stands

Working and verified:

- **Baseline calibration** — a built-in passage read at natural pace sets your
  starting target, so every later number has a zero point.
- **Three reading modes** — RSVP, a guided pacer over real layout, and untimed
  natural reading. The pacer is the one that transfers off-screen.
- **Speed-push protocol** — escalating over-speed passes over a section, then a
  measured read of unseen material at 1.3x. The highest-leverage drill in the
  app, and the overload scales to how you are coping.
- **Adaptive target** — an asymmetric staircase driven by 5-question quizzes,
  with option shuffling and validation so the signal is real.
- **Library** — passages persist, resume mid-text, and come back on a spaced
  schedule for retention checks.
- **Four neuro-drills** — chunk perception, Schulte table, perceptual span and
  visual search, all adaptive and tracked. The staircases now open near your
  recent threshold instead of restarting from scratch every run.
- **Reading environment** — full typographic control with a live preview,
  applied identically across every reading mode.
- **Training plans** — write your own path, tick steps off, share as Markdown
  that anyone can read, edit or write by hand.
- **Question checking** — generated quizzes are verified against being
  answerable without reading the passage.
- **AI optional** — direct Gemini calls, or a copy/paste exchange with any
  assistant. Fully usable with no API key.
- **Export/import** of the whole profile, plans included, and keyboard control
  of the reader.
- **Document import** — EPUB, PDF, DOCX, HTML and plain text, all verified
  against real files.
- **292 tests, zero lint errors.**

## Next

### 1. Question checking on the copy/paste path

The API path now verifies questions by answering them blind and dropping any it
gets right. The copy/paste path does not, because it would mean a second paste
round mid-flow. Worth adding as an optional extra step for people training
without a key.

### 2. Skim mode as a first-class thing

The honest route to numbers like 2,000 WPM. Reading every word tops out around
500-600; past roughly 700 you are sampling text, not reading it. That is a real
and useful skill, but it needs its own mode with its own comprehension
expectations — gist questions rather than detail questions — so that a skim
session is not scored as though it were a careful read, and eWPM stays
meaningful in both.

### 3. Article URLs

File import now covers EPUB, PDF, DOCX, HTML and plain text. The gap left is
pasting a URL and having the article fetched and stripped of furniture, which
needs either a CORS proxy or a small server route — the browser cannot fetch
arbitrary origins directly.

### 4. A real vocabulary trainer

The glossary moved into the Guide, where it belonged, and the standalone view is
gone. A genuine replacement would pull uncommon words from passages *you* have
read, let you flag the ones that slowed you down, and drill them — unfamiliar
words force fixations, so this is a direct speed lever rather than a side
feature. It needs a frequency list to pick candidates, which is the open
question.

## Known limitations

- **Storage is `localStorage` only.** There is now an export/import pair in
  Settings, but nothing is automatic — no sync, and no reminder to back up.
  Clearing site data between exports is still unrecoverable.
- **The AI key is bundled into the client.** Fine locally, not fine deployed —
  a `VITE_` variable is readable by anyone who loads the page. Deploying
  publicly means putting the call behind a server route first.
- **Video Summary is a summary, not a transcript.** It asks a search-grounded
  model what it can find about a video. Treat detail as approximate.
- **The baseline is a single sample** — one passage, one topic, one day. Two or
  three passages averaged would make "+X% since baseline" mean more.
