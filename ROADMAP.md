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
- **AI optional** — a local model through Ollama (default, no key, nothing leaves
  the machine), direct Gemini calls, or a copy/paste exchange with any assistant.
  Fully usable with no AI at all.
- **Export/import** of the whole profile, plans included, and keyboard control
  of the reader.
- **Document import** — EPUB, PDF, DOCX, HTML and plain text, all verified
  against real files.
- **Skim mode** — a fourth reading mode at 2.5x your target (at least 700 WPM),
  checked with gist questions when the passage has them. Skims are logged and
  charted on their own and never move the reading target or the averages.
- **Averaged baseline** — up to three calibration passages, averaged. Adding one
  later leaves a target that training has already moved alone.
- **Vocabulary trainer** — uncommon words pulled from passages you have read,
  saved with their sentence, reviewed on a spaced schedule, plus a flash
  recognition drill. Definitions from the AI provider when one is available.
- **Question checking on the copy/paste path** — offered as an optional second
  paste before the passage starts.
- **Backup reminder** on the dashboard after unexported sessions, with a snooze.
- **Dashboard and analytics** — a "do this next" card, training heatmap,
  sparklines; eWPM trend line, frontier by recency, per-mode table, weekly
  minutes and drill thresholds. History keeps 1,000 sessions.
- **App theme** — dark (default), light or system, and a phone layout with a
  bottom tab bar. Reading, pushes and retention checks run full-screen.
- **Reader controls** — a settings drawer inside the reader (page, RSVP,
  pacer style and session options, applied live), a clickable progress bar,
  back/skip and restart, click-a-word to jump, countdown, warm-up ramp, zen
  mode and full screen. Jumps keep the word count honest.
- **Book mode** — long imports (3,000+ words, or an EPUB with chapters) become
  a book: the file's own chapters, headings found in the text, or ~2,500-word
  parts. Progress is kept per chapter, the dashboard offers the next one, and
  bookmarks jump back to a word. A book too large for browser storage is
  refused up front rather than breaking every later save.
- **Speed push controls** — the reader's settings drawer, pacer styles,
  countdown, zen mode and full screen also work in the push drill.
- **Phrase-grouped flashes** — with 2-5 words per flash, RSVP groups follow
  phrases instead of fixed slices: never across a sentence end or heading,
  preferably at commas and before conjunctions, never ending on "the" or "of",
  balanced within a sentence and shorter when the words are long. Timing
  follows word length (averaging out to the chosen WPM) with a beat at
  punctuation; groups are centred and wrap to two balanced lines. Import
  cleanup closes up stray punctuation ("word ,"), spaced ellipses and dashes.
- **Vocabulary ranked by real word frequency** — the top 20,000 English words
  from wordfreq (CC BY-SA 4.0, see `src/data/WORDFREQ-NOTICE.md`), loaded only
  when the Vocabulary page opens.
- **395 tests, zero lint errors.**

## Next

### 1. Quizzes for your own text

Imported books and articles have no questions, so they count as practice and
never move the target speed. The local model could write questions per chapter
or per chunk, checked blind the same way as generated passages.

### 2. Article URLs

File import now covers EPUB, PDF, DOCX, HTML and plain text. The gap left is
pasting a URL and having the article fetched and stripped of furniture, which
needs either a CORS proxy or a small server route — the browser cannot fetch
arbitrary origins directly.


## Known limitations

- **Storage is `localStorage` only, about 5 MB.** Books share the library's
  key, so a few long novels fill it. There is an export/import pair in
  Settings and a dashboard reminder, but nothing is automatic — no sync.
  Clearing site data between exports is still unrecoverable.
- **The AI key is bundled into the client.** Fine locally, not fine deployed —
  a `VITE_` variable is readable by anyone who loads the page. Deploying
  publicly means putting the call behind a server route first.
- **Video Summary is a summary, not a transcript.** It asks a search-grounded
  model what it can find about a video. Treat detail as approximate. Local models
  can't search, so with the local provider it uses copy/paste. A real fix would be
  transcribing the video locally (media-api can already do this) and writing the
  passage from the transcript.
- **Local generation speed depends on what else is using the GPU.** Measured
  10-20s per passage with the model loaded, 30-40s including a cold load.
