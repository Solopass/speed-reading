import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    ArrowUpDown, Bookmark, ChevronLeft, ChevronRight, ExternalLink, Maximize2, Minimize2, Minus, Pause, Play, Plus, RotateCcw, Search, Settings2, SkipBack, SkipForward, Target, Volume2, X
} from 'lucide-react';
import { normalizeQuestions } from '../lib/quiz';
import useHotkeys from '../lib/useHotkeys';
import PacedText from '../components/PacedText';
import ScrollText from '../components/ScrollText';
import PassageText from '../components/PassageText';
import ReadingSurface from '../components/ReadingSurface';
import ReaderSettings from '../components/ReaderSettings';
import { focalColorFor, rampFactor } from '../lib/readingStyle';
import { focalRange, orpIndex, rsvpWordScale, searchTextMatches } from '../lib/scrollUtils';
import { clampIndex, clock, extractSections, jump, startCount, wordsCovered } from '../lib/readerNav';
import { buildChunks, chunkIndexAt, endsSentence, joinFlashWords, pauseAfter, tokenize, wordWeights } from '../lib/chunker';
import { buildCloze, difficultyBuckets, difficultyScores, nextChunkSize, speedTrace } from '../lib/checkpoint';
import { loadFrequencyRank } from '../lib/vocab';
import Quiz from '../components/Quiz';
import CheckpointCard from '../components/CheckpointCard';
import SpeedTraceLine from '../components/SpeedTraceLine';

/** Words skipped by the rewind and skip controls. */
const SKIP_WORDS = 10;
const WPM_PRESETS = [200, 300, 400, 500, 650, 800, 1000, 1100, 1250, 1500];
/** Flash text size for multi-word groups, relative to the single-word size, by "words per flash". */
const MULTI_SCALE = { 2: 0.78, 3: 0.68, 4: 0.6, 5: 0.56 };
/** Height of the flash box: fixed per setting so one- and two-line groups do not shift the page. */
const flashBoxHeight = (chunkSize) => (chunkSize > 1
    ? `max(9rem, calc(var(--reading-rsvp-size) * ${((MULTI_SCALE[Math.min(chunkSize, 5)] ?? 0.56) * 2.4 + 0.35).toFixed(2)}))`
    : 'max(9rem, calc(var(--reading-rsvp-size) * 1.6))');

const Kbd = ({ children }) => <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400 font-mono">{children}</kbd>;

function KeyboardHint() {
    return (
        <p className="text-[11px] text-slate-600 mt-2 flex items-center justify-center gap-x-3 gap-y-1 flex-wrap">
            <span><Kbd>space</Kbd> play/pause</span>
            <span><Kbd>↑↓</Kbd> speed</span>
            <span><Kbd>[ ]</Kbd> back/skip {SKIP_WORDS}</span>
            <span><Kbd>{'{ }'}</Kbd> prev/next sentence</span>
            <span><Kbd>R</Kbd> restart</span>
            <span><Kbd>Z</Kbd> zen</span>
            <span><Kbd>S</Kbd> settings</span>
            <span><Kbd>B</Kbd> bookmark (books)</span>
            <span><Kbd>F</Kbd> full screen</span>
            <span><Kbd>- =</Kbd> text size</span>
            <span><Kbd>shift</Kbd> hold to slow</span>
            <span><Kbd>esc</Kbd> exit</span>
        </p>
    );
}

/** Skimming starts well past reading speed: below ~700 WPM it is just fast reading. */
export const skimStartWpm = (targetWpm) => Math.min(2500, Math.max(700, Math.round((targetWpm * 2.5) / 50) * 50));

/**
 * Clickable progress bar. Clicking or using the arrow keys on it jumps the
 * reading position; the word count stays honest because the Reader banks what
 * was covered before every jump.
 */
function Scrubber({ index, total, onSeek, label, heat = null }) {
    const [dragging, setDragging] = useState(false);
    const [previewIdx, setPreviewIdx] = useState(null);
    const barRef = useRef(null);
    const activeIdx = dragging && previewIdx !== null ? previewIdx : index;
    const pct = total ? Math.max(0, Math.min(100, (activeIdx / total) * 100)) : 0;

    const indexFromClientX = (clientX) => {
        const rect = barRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0) return index;
        const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return Math.round(frac * total);
    };

    return (
        <div
            ref={barRef}
            role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={activeIdx}
            onPointerDown={(e) => {
                e.preventDefault();
                const next = indexFromClientX(e.clientX);
                setDragging(true);
                setPreviewIdx(next);
                onSeek(next);
                e.currentTarget.setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
                if (!dragging) return;
                const next = indexFromClientX(e.clientX);
                setPreviewIdx(next);
                onSeek(next);
            }}
            onPointerUp={(e) => {
                if (!dragging) return;
                setDragging(false);
                setPreviewIdx(null);
                e.currentTarget.releasePointerCapture?.(e.pointerId);
            }}
            onPointerCancel={(e) => {
                if (!dragging) return;
                setDragging(false);
                setPreviewIdx(null);
                e.currentTarget.releasePointerCapture?.(e.pointerId);
            }}
            onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); onSeek(index - SKIP_WORDS); }
                if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); onSeek(index + SKIP_WORDS); }
            }}
            className="relative group w-full max-w-lg py-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 rounded touch-none"
        >
            {dragging && (
                <div
                    className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded bg-purple-600 text-white text-[11px] font-mono font-bold shadow pointer-events-none whitespace-nowrap"
                    style={{ left: `${pct}%` }}
                >
                    {Math.round(pct)}% · {activeIdx}
                </div>
            )}
            <div className="h-2 group-hover:h-3 transition-all bg-slate-800 rounded-full overflow-hidden">
                <div className={`h-full bg-purple-600 ${dragging ? '' : 'transition-[width] duration-200'}`} style={{ width: `${pct}%` }} />
            </div>
            {heat?.length > 0 && (
                // How dense the text is along the way: darker amber is harder going.
                <div className="mt-1 h-1 flex rounded-full overflow-hidden" aria-hidden="true" title="Difficulty ahead: darker is denser text">
                    {heat.map((h, i) => (
                        <div key={i} className="flex-1 bg-amber-400" style={{ opacity: 0.08 + h * 0.62 }} />
                    ))}
                </div>
            )}
        </div>
    );
}

function Reader({
    passage, book = null, onSelectChapter = null, settings, reading, patchReading, updateSettings,
    customPresets = [], onSavePresets = null, popoutWin: liftedPopoutWin = null, onPopoutChange = null,
    initialWpm, resumeFrom = 0, onFinish, onLeave, onExit, onBookmark = null, addNotification, onGenerateQuiz = null
}) {
    // The baseline test measures your natural pace, so it is always read as
    // ordinary text with no pacing and no speed control.
    const isCalibration = passage?.isCalibration === true;

    // Paced and Scroll can each keep their own speed, stored as a factor of
    // the RSVP speed so the adaptive target still moves all of them together.
    const separateSpeeds = settings.separateModeSpeeds !== false;
    const speedFactor = (m) => {
        const f = separateSpeeds && m !== 'rsvp' ? Number(settings.modeSpeedFactor?.[m]) : 1;
        return Number.isFinite(f) && f > 0 ? Math.min(3, Math.max(0.3, f)) : 1;
    };
    const baseWpmRef = useRef(initialWpm);
    const [readWpm, setReadWpm] = useState(() => {
        const startMode = isCalibration ? 'natural' : (settings.readerMode || 'rsvp');
        return Math.round(initialWpm * speedFactor(startMode));
    });
    // Skim runs at its own speed, so trying a skim and switching back does not
    // leave the reading speed at 1,000 WPM.
    const [skimWpm, setSkimWpm] = useState(() => settings.skimWpm ?? skimStartWpm(initialWpm));
    const safeResume = Math.max(0, resumeFrom);
    const [isPlaying, setIsPlaying] = useState(() => Boolean(passage?.autoStart) && !isCalibration && (settings.readerMode || 'rsvp') !== 'natural');
    const [currentIndex, setCurrentIndex] = useState(safeResume);
    const [mode, setMode] = useState(isCalibration ? 'natural' : (settings.readerMode || 'rsvp'));
    const [isAudioReady, setIsAudioReady] = useState(false);
    const [quizActive, setQuizActive] = useState(false);
    // Measurement is frozen when the quiz opens; the clock must not keep
    // influencing the recorded speed while questions are being answered.
    const [pending, setPending] = useState(null);
    // Natural mode has no play button, so without an explicit start the clock
    // would run while you read the instructions — understating your speed, and
    // for the baseline test miscalibrating every target that follows.
    const [naturalStarted, setNaturalStarted] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [countdown, setCountdown] = useState(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [localPopoutWin, setLocalPopoutWin] = useState(null);
    const popoutWin = onPopoutChange ? liftedPopoutWin : localPopoutWin;
    const setPopoutWin = onPopoutChange ?? setLocalPopoutWin;
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const searchInputRef = useRef(null);

    const [pacedIndex, setPacedIndex] = useState(safeResume);
    const [pacedSeek, setPacedSeek] = useState(null);
    const [pacedInitialIndex, setPacedInitialIndex] = useState(safeResume);
    const [wpmMenuOpen, setWpmMenuOpen] = useState(false);
    const [bookmarkOpen, setBookmarkOpen] = useState(false);
    const [bookmarkNote, setBookmarkNote] = useState('');
    const bookmarkInputRef = useRef(null);
    const wpmMenuRef = useRef(null);
    const touchStartRef = useRef(null);
    const lastNonScrollModeRef = useRef(mode === 'scroll' ? 'rsvp' : mode);

    useEffect(() => {
        if (!wpmMenuOpen) return undefined;
        const onPointerDown = (e) => {
            if (!wpmMenuRef.current?.contains(e.target)) setWpmMenuOpen(false);
        };
        window.addEventListener('pointerdown', onPointerDown);
        return () => window.removeEventListener('pointerdown', onPointerDown);
    }, [wpmMenuOpen]);

    useEffect(() => {
        if (!bookmarkOpen) return undefined;
        bookmarkInputRef.current?.focus();
        // The reader's shortcuts are off while the dialog is open, so it
        // needs its own Escape to close.
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setBookmarkOpen(false); } };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [bookmarkOpen]);

    const isSkim = mode === 'skim';
    const isScroll = mode === 'scroll';
    const isPacer = mode === 'paced' || mode === 'skim';
    const wpm = isSkim ? skimWpm : readWpm;
    const setWpm = isSkim ? setSkimWpm : setReadWpm;

    const words = useMemo(() => {
        if (!passage?.text) return [];
        return passage.text.trim().split(/\s+/).filter(w => w.length > 0);
    }, [passage]);

    const paraEnds = useMemo(() => {
        const ends = new Set();
        if (!passage?.text) return ends;
        let idx = 0;
        for (const p of passage.text.trim().split(/\n\s*\n/)) {
            const count = p.trim().split(/\s+/).filter(Boolean).length;
            if (count > 0) {
                idx += count;
                ends.add(idx - 1);
            }
        }
        return ends;
    }, [passage]);

    const sections = useMemo(() => (book ? [] : extractSections(passage?.text ?? '')), [book, passage?.text]);

    // RSVP flashes follow phrase and sentence boundaries rather than fixed
    // slices (see chunker.js). Indices are the same as `words`.
    const smartChunks = settings.smartChunks !== false;
    const chunks = useMemo(
        () => buildChunks(passage?.text ?? '', { maxWords: settings.chunkSize, smart: smartChunks, mergeShortWords: reading.rsvpMergeShortWords }),
        [passage?.text, settings.chunkSize, smartChunks, reading.rsvpMergeShortWords]
    );
    const gaps = useMemo(() => tokenize(passage?.text ?? '').map(t => t.gap), [passage?.text]);
    // Word frequencies, loaded once, so rare words can get a little more time.
    const [rank, setRank] = useState(null);
    useEffect(() => {
        if (!(reading.rarityPacing || reading.difficultyMap || reading.checkpoints || reading.scrollEaseHard)) return undefined;
        let live = true;
        loadFrequencyRank().then(r => { if (live) setRank(r); }).catch(() => {});
        return () => { live = false; };
    }, [reading.rarityPacing, reading.difficultyMap, reading.checkpoints, reading.scrollEaseHard]);
    // How hard each word is going (rarity, sentence length), for the progress
    // bar's difficulty strip and for Scroll easing off before dense stretches.
    const difficulty = useMemo(
        () => (reading.difficultyMap || reading.scrollEaseHard ? difficultyScores(words, rank) : null),
        [words, rank, reading.difficultyMap, reading.scrollEaseHard]
    );
    const heat = useMemo(() => (reading.difficultyMap && difficulty ? difficultyBuckets(difficulty, 80) : null), [difficulty, reading.difficultyMap]);
    const weights = useMemo(() => wordWeights(words, reading.rarityPacing ? rank : null), [words, rank, reading.rarityPacing]);
    /** End (exclusive) of the flash that starts at word `index`. */
    const flashEnd = useCallback((index) => {
        if (index >= words.length) return words.length;
        const c = chunks[chunkIndexAt(chunks, index)];
        return c && c.end > index ? c.end : index + 1;
    }, [chunks, words.length]);

    // Validated and shuffled once per passage: a model can return a bad answer
    // index or duplicate options, and re-shuffling on every render would move
    // the options under the reader's cursor.
    const detailQuestions = useMemo(() => normalizeQuestions(passage?.questions), [passage]);
    // A skim is checked on gist when the passage came with gist questions.
    // Otherwise it falls back to the detail questions, which is harsh on a
    // skim, so those sessions are still kept out of the reading averages.
    const gistQuestions = useMemo(() => normalizeQuestions(passage?.gistQuestions), [passage]);
    // Questions written at the end of a chapter that had none (see handleFinishReading).
    const [extraQuestions, setExtraQuestions] = useState(null);
    const [quizWriting, setQuizWriting] = useState(false);
    const quizWritingCancelledRef = useRef(false);
    const questions = extraQuestions ?? (isSkim && gistQuestions.length > 0 ? gistQuestions : detailQuestions);

    // Where the reader is now, in whichever mode is running.
    const cursorIndex = mode === 'rsvp' ? Math.min(currentIndex, words.length) : Math.min(pacedIndex, words.length);

    // The warm-up ramp eases the speed in over the first quarter. Quantised to
    // 5% steps so the pacer is not re-timed on every single word.
    const ramp = Math.round(rampFactor(words.length ? cursorIndex / words.length : 1, reading.speedRamp && !isCalibration) * 20) / 20;
    const [accelSecs, setAccelSecs] = useState(0);
    const accelBonus = Math.min(
        Math.max(0, wpm * (reading.accelCapPct / 100) - wpm),
        Math.floor(((reading.accelWpmPerMin * accelSecs) / 60) / 5) * 5
    );
    // Holding Shift slows everything down through a hard patch; letting go resumes.
    const [holdSlow, setHoldSlow] = useState(false);
    useEffect(() => {
        const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '');
        const down = (e) => { if (e.key === 'Shift' && !typing(e)) setHoldSlow(true); };
        const up = (e) => { if (e.key === 'Shift') setHoldSlow(false); };
        const reset = () => setHoldSlow(false);
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('blur', reset);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
            window.removeEventListener('blur', reset);
        };
    }, []);
    const slowFactor = holdSlow && !isCalibration ? reading.holdSlowPct / 100 : 1;
    const effectiveWpm = Math.min(2500, Math.max(50, Math.round((wpm * ramp + (isCalibration ? 0 : accelBonus)) * slowFactor)));

    // --- Reading clock -----------------------------------------------------
    // Wall-clock time spent actually reading, excluding pauses. The WPM control
    // is only a *target*; punctuation pacing, pausing and Natural mode all make
    // real speed differ from it, so the recorded session uses measured time.
    const runningSinceRef = useRef(null);
    const accumulatedMsRef = useRef(0);

    const startClock = useCallback(() => {
        if (runningSinceRef.current === null) runningSinceRef.current = Date.now();
    }, []);

    const stopClock = useCallback(() => {
        if (runningSinceRef.current !== null) {
            accumulatedMsRef.current += Date.now() - runningSinceRef.current;
            runningSinceRef.current = null;
        }
    }, []);

    const elapsedMs = useCallback(() => (
        accumulatedMsRef.current + (runningSinceRef.current !== null ? Date.now() - runningSinceRef.current : 0)
    ), []);

    // Hiding the tab stops the pacer entirely (no animation frames) and
    // throttles RSVP's timers, but wall-clock time keeps running — so a session
    // left in a background tab would record a badly deflated speed.
    const [isHidden, setIsHidden] = useState(false);
    useEffect(() => {
        const onVisibilityChange = () => {
            const hidden = document.visibilityState === 'hidden';
            setIsHidden(hidden);
            // Cancel a pending countdown too, or it would start playback in the background.
            if (hidden) { setIsPlaying(false); setCountdown(null); }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, []);

    // RSVP and the pacers run the clock while playing; Natural runs it the
    // whole time the text is on screen. Either way a hidden tab stops it.
    useEffect(() => {
        // Time spent in the settings drawer is not reading time, in any mode.
        if (!isHidden && !settingsOpen && ((mode === 'natural' && naturalStarted) || isPlaying)) startClock();
        else stopClock();
    }, [mode, naturalStarted, isPlaying, isHidden, settingsOpen, startClock, stopClock]);

    useEffect(() => stopClock, [stopClock]);

    // Time read so far, for the status line. Sampled once a second while the
    // clock runs, rather than read off the clock during render.
    const [elapsedSecs, setElapsedSecs] = useState(0);
    const clockRunning = !isHidden && !settingsOpen && ((mode === 'natural' && naturalStarted) || isPlaying);
    useEffect(() => {
        if (!clockRunning) return undefined;
        const id = setInterval(() => setElapsedSecs(Math.round(elapsedMs() / 1000)), 1000);
        return () => clearInterval(id);
    }, [clockRunning, elapsedMs]);

    // The speed builder counts seconds of actual playback (not pauses, not the
    // settings drawer), and keeps counting across mode switches.
    const accelOn = reading.accelWpmPerMin > 0 && !isCalibration;
    useEffect(() => {
        if (!accelOn || !clockRunning || !isPlaying) return undefined;
        const id = setInterval(() => setAccelSecs(s => s + 1), 1000);
        return () => clearInterval(id);
    }, [accelOn, clockRunning, isPlaying]);

    // --- Measurement while reading ------------------------------------------
    // Seconds of actual playback, one trace sample per second (position and
    // whether Shift was held), and the checkpoint schedule that runs off them.
    const [playSecs, setPlaySecs] = useState(0);
    const playSecsRef = useRef(0);
    const traceRef = useRef([]);
    const rewindEventsRef = useRef([]);
    const [trace, setTrace] = useState(null);
    const holdSlowRef = useRef(false);
    const traceCursorRef = useRef(cursorIndex);
    useLayoutEffect(() => { holdSlowRef.current = holdSlow; traceCursorRef.current = cursorIndex; });
    useEffect(() => {
        if (!clockRunning || !isPlaying || mode === 'natural' || isCalibration) return undefined;
        const id = setInterval(() => {
            playSecsRef.current += 1;
            const t = playSecsRef.current;
            traceRef.current.push({ t, idx: traceCursorRef.current, slow: holdSlowRef.current });
            if (traceRef.current.length > 7200) traceRef.current.shift();
            setPlaySecs(t);
            if (t % 5 === 0) setTrace(speedTrace(traceRef.current, 10, rewindEventsRef.current));
        }, 1000);
        return () => clearInterval(id);
    }, [clockRunning, isPlaying, mode, isCalibration]);

    const [checkpoint, setCheckpoint] = useState(null);
    const [checkStats, setCheckStats] = useState({ asked: 0, right: 0 });
    const lastCheckRef = useRef({ secs: 0, idx: safeResume });
    useEffect(() => {
        // Skim is read for gist, so a check on one exact word would be unfair there.
        if (!reading.checkpoints || isCalibration || mode === 'natural' || mode === 'skim' || !isPlaying || checkpoint) return;
        const since = playSecs - lastCheckRef.current.secs;
        const every = reading.checkpointEveryMin * 60;
        if (since < every) return;
        // Wait for a sentence to finish, unless that is taking too long.
        const atSentenceEnd = cursorIndex > 0 && endsSentence(words[cursorIndex - 1], words[cursorIndex]);
        if (!atSentenceEnd && since < every + 20) return;
        const cloze = buildCloze(words, lastCheckRef.current.idx, cursorIndex, { rank });
        lastCheckRef.current = { secs: playSecs, idx: cursorIndex };
        if (!cloze) return;
        queueMicrotask(() => {
            setIsPlaying(false);
            setCountdown(null);
            setCheckpoint({ cloze, picked: null });
        });
    }, [playSecs, cursorIndex, reading.checkpoints, reading.checkpointEveryMin, isCalibration, mode, isPlaying, checkpoint, words, rank]);

    const answerCheckpoint = useCallback((i) => {
        if (!checkpoint || checkpoint.picked !== null) return;
        const ok = i === checkpoint.cloze.answerIndex;
        setCheckpoint({ ...checkpoint, picked: i });
        setCheckStats(st => ({ asked: st.asked + 1, right: st.right + (ok ? 1 : 0) }));
        const log = [...(Array.isArray(settings.checkpointLog) ? settings.checkpointLog : []), { ok, size: settings.chunkSize, mode }].slice(-30);
        const patch = { checkpointLog: log };
        // Words per flash follows how well the checks go, between 2 and 5.
        if (reading.adaptiveChunk && mode === 'rsvp' && settings.chunkSize >= 2) {
            const next = nextChunkSize(log.filter(e => e.mode === 'rsvp'), settings.chunkSize);
            if (next !== settings.chunkSize) {
                patch.chunkSize = next;
                addNotification?.(`Words per flash ${next > settings.chunkSize ? 'up' : 'down'} to ${next}.`, next > settings.chunkSize ? 'success' : undefined);
            }
        }
        updateSettings?.(patch);
        if (!ok && accelSecs > 0) {
            setAccelSecs(0);
            addNotification?.('Missed check: the speed builder starts again from your base speed.');
        }
    }, [checkpoint, settings.checkpointLog, settings.chunkSize, mode, reading.adaptiveChunk, updateSettings, addNotification, accelSecs]);
    const continueAfterCheckpoint = useCallback(() => { setCheckpoint(null); setIsPlaying(true); }, []);
    const skipCheckpoint = useCallback(() => { setCheckpoint(null); setIsPlaying(true); }, []);

    // --- Full screen ---------------------------------------------------------
    useEffect(() => {
        const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    const toggleFullscreen = useCallback(() => {
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        else document.documentElement.requestFullscreen?.().catch(() => addNotification?.('Full screen is not available here.'));
    }, [addNotification]);

    // Leaving the reader leaves full screen too.
    useEffect(() => () => { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); }, []);

    // --- Audio sync --------------------------------------------------------
    // One utterance per flash, cancelling the previous one, so speech can never
    // lag behind the visual.
    useEffect(() => {
        if (!settings.audioSyncEnabled || !isAudioReady || mode !== 'rsvp' || !isPlaying) return;
        const synth = window.speechSynthesis;
        if (!synth) return;

        const chunk = words.slice(currentIndex, flashEnd(currentIndex)).join(' ');
        if (!chunk) return;

        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.rate = Math.min(4, Math.max(0.5, effectiveWpm / 180));
        synth.cancel();
        synth.speak(utterance);
    }, [currentIndex, isPlaying, isAudioReady, mode, effectiveWpm, words, settings.audioSyncEnabled, flashEnd]);

    useEffect(() => {
        if (!isPlaying || mode !== 'rsvp') window.speechSynthesis?.cancel();
    }, [isPlaying, mode]);

    useEffect(() => () => window.speechSynthesis?.cancel(), []);

    /**
     * Measured speed over the words actually read. Clamped because a Natural-mode
     * reader who hits "Finished" immediately would otherwise record a fantasy number.
     */
    const measuredWpm = useCallback((wordsRead) => {
        const ms = elapsedMs();
        if (ms < 500 || wordsRead <= 0) return wpm;
        return Math.min(2500, Math.max(50, Math.round(wordsRead / (ms / 60000))));
    }, [elapsedMs, wpm]);

    // Words covered *this sitting*, banked across every rewind and skip (see
    // readerNav.js). Resuming at word 200 counts from 200; Natural mode has no
    // cursor, so the whole passage counts.
    const countRef = useRef(startCount(resumeFrom));
    const wordsRead = useCallback(() => {
        if (mode === 'natural') return words.length;
        return wordsCovered(countRef.current, cursorIndex);
    }, [mode, cursorIndex, words.length]);

    const switchMode = (nextMode) => {
        if (nextMode === mode) return;
        pause();
        setWpmMenuOpen(false);
        setNaturalStarted(false);
        if (nextMode !== 'scroll') lastNonScrollModeRef.current = nextMode;
        const at = clampIndex(cursorIndex, words.length);
        accumulatedMsRef.current = 0;
        runningSinceRef.current = null;
        setElapsedSecs(0);
        countRef.current = startCount(at);
        lastCheckRef.current = { ...lastCheckRef.current, idx: at };
        if (nextMode === 'rsvp') setCurrentIndex(at);
        else if (nextMode === 'paced' || nextMode === 'skim' || nextMode === 'scroll') {
            setPacedInitialIndex(at);
            setPacedIndex(at);
            setPacedSeek(prev => ({ index: at, nonce: (prev?.nonce ?? 0) + 1 }));
        }
        // Each reading mode opens at its own remembered speed.
        if (nextMode === 'rsvp' || nextMode === 'paced' || nextMode === 'scroll') {
            setReadWpm(Math.min(2000, Math.max(100, Math.round(baseWpmRef.current * speedFactor(nextMode)))));
        }
        setMode(nextMode);
        updateSettings?.({ readerMode: nextMode });
    };

    // The live position for jumps. Updated on every render and immediately by
    // each jump, so two jumps in quick succession chain instead of both
    // starting from the same stale position (which would over-credit words).
    const cursorRef = useRef(cursorIndex);
    useLayoutEffect(() => { cursorRef.current = cursorIndex; });

    /** Jump to a word, in RSVP or the pacers. */
    const seekTo = useCallback((target, { auto = false } = {}) => {
        if (mode === 'natural' || words.length === 0) return;
        let to = clampIndex(target, words.length);
        // A jump in RSVP lands on the start of the phrase holding that word.
        // A small step forward that stays inside the current group moves on to
        // the next group instead of snapping back (the wheel steps 3 words).
        if (mode === 'rsvp' && to < words.length && chunks.length) {
            const from = cursorRef.current;
            const start = chunks[chunkIndexAt(chunks, to)].start;
            const nextStart = flashEnd(from);
            to = to > from && start <= from && nextStart < words.length ? nextStart : start;
        }
        if (!auto && to < cursorRef.current) rewindEventsRef.current.push(playSecsRef.current);
        // The next checkpoint asks about text read, not text jumped over: a jump
        // forward starts the window here; stepping back keeps what was already read.
        const prevIdx = lastCheckRef.current.idx;
        lastCheckRef.current = { ...lastCheckRef.current, idx: to > cursorRef.current ? to : Math.min(prevIdx, to) };
        countRef.current = jump(countRef.current, cursorRef.current, to);
        cursorRef.current = to;
        if (mode === 'rsvp') setCurrentIndex(to);
        else {
            setPacedIndex(to);
            setPacedSeek(prev => ({ index: to, nonce: (prev?.nonce ?? 0) + 1 }));
        }
    }, [mode, words.length, chunks, flashEnd]);

    const seekBy = useCallback((delta, opts) => seekTo(cursorRef.current + delta, opts), [seekTo]);

    // Position within the whole passage, for the library's resume point.
    const absoluteIndex = mode === 'rsvp' ? currentIndex : pacedIndex;
    const chapterIndex = Number.isInteger(passage?.chapterIndex) ? passage.chapterIndex : null;
    const leaveRef = useRef({ onLeave, passageId: passage?.id, chapterIndex, absoluteIndex, finished: false });
    useLayoutEffect(() => {
        leaveRef.current = { ...leaveRef.current, onLeave, passageId: passage?.id, chapterIndex, absoluteIndex, mode };
    });

    // Navigating away mid-passage saves where you got to; finishing does not,
    // since completing already resets the resume point.
    useEffect(() => () => {
        const { onLeave: leave, passageId, chapterIndex: chapter, absoluteIndex: at, finished } = leaveRef.current;
        if (!finished) leave?.({ passageId, chapterIndex: chapter, progressIndex: at, mode: leaveRef.current.mode });
    }, []);

    /**
     * Ends the reading. `atIndex` is where the cursor finished: the RSVP and
     * pacer completion paths pass the end of the passage, because the visible
     * cursor state still lags one flash or one frame behind at that moment.
     */
    const handleFinishReading = useCallback((atIndex = null) => {
        stopClock();
        const covered = mode === 'natural'
            ? words.length
            : Number.isInteger(atIndex) ? wordsCovered(countRef.current, atIndex) : wordsRead();
        const measured = {
            wpm: measuredWpm(covered), words: covered, elapsedMs: elapsedMs(),
            mode: isCalibration ? 'natural' : mode
        };
        if (questions.length > 0) {
            setPending(measured);
            setQuizActive(true);
            return;
        }
        const finishPlain = () => {
            leaveRef.current.finished = true;
            onFinish({ ...measured, score: null });
        };
        // A book chapter with no quiz would only count as practice; with an AI
        // available, write one now so the chapter counts as training.
        if (reading.chapterEndQuiz && onGenerateQuiz && passage?.bookId && !isSkim && mode !== 'natural' && !isCalibration) {
            setPending(measured);
            setQuizWriting(true);
            quizWritingCancelledRef.current = false;
            onGenerateQuiz(passage)
                .then((res) => {
                    if (quizWritingCancelledRef.current) return;
                    const qs = normalizeQuestions(res?.questions);
                    if (qs.length > 0) { setExtraQuestions(qs); setQuizActive(true); } else finishPlain();
                })
                .catch(() => { if (!quizWritingCancelledRef.current) finishPlain(); })
                .finally(() => setQuizWriting(false));
            return;
        }
        finishPlain();
    }, [stopClock, wordsRead, words.length, questions, onFinish, measuredWpm, elapsedMs, mode, isCalibration, reading.chapterEndQuiz, onGenerateQuiz, passage, isSkim, setQuizWriting, setExtraQuestions]);

    // Timers and the pacer call the latest finish handler through a ref, so
    // their effects do not restart every time the parent re-renders (which
    // recreated the handler and reset the RSVP flash timer mid-word).
    // Leaving while a chapter quiz is being written: its late answer must not
    // finish the session from another page.
    useEffect(() => () => { quizWritingCancelledRef.current = true; }, []);

    const finishRef = useRef(handleFinishReading);
    useLayoutEffect(() => { finishRef.current = handleFinishReading; });

    // --- RSVP advance (zero-drift rAF accumulator for 1,000+ WPM) -----------
    const rsvpDeadlineRef = useRef(0);
    // Blink breaks: RSVP holds the eyes so still that people stop blinking.
    // Every so often, preferably at a sentence end, the flash goes blank briefly.
    const BLINK_MS = 300;
    const [blinking, setBlinking] = useState(false);
    const lastBlinkRef = useRef(0);
    const blinkTimerRef = useRef(null);
    const playingRef = useRef(isPlaying);
    const rsvpIndexRef = useRef(currentIndex);
    useLayoutEffect(() => { playingRef.current = isPlaying; rsvpIndexRef.current = currentIndex; });
    useEffect(() => {
        if (!isPlaying || mode !== 'rsvp' || words.length === 0 || currentIndex >= words.length) {
            rsvpDeadlineRef.current = 0;
            return undefined;
        }

        const end = flashEnd(currentIndex);
        const wordMs = 60000 / effectiveWpm;
        // Long words get a little more time and short ones a little less; the
        // weights average 1 over the passage, so the average speed is unchanged.
        let units = 0;
        for (let i = currentIndex; i < end; i++) units += weights[i] ?? 1;
        let delayMs = wordMs * units;
        if (settings.punctuationPacing) {
            delayMs += wordMs * pauseAfter(words[end - 1], gaps[end - 1] ?? 0, words[end]);
            if (paraEnds.has(end - 1) && end < words.length) delayMs += Math.min(220, wordMs * 0.45);
        }

        const now = performance.now();
        const base = rsvpDeadlineRef.current > 0 && now - rsvpDeadlineRef.current < 100 ? rsvpDeadlineRef.current : now;
        const targetAt = base + delayMs;
        let frame = 0;

        const advance = () => {
            if (end >= words.length) {
                setCurrentIndex(words.length);
                setIsPlaying(false);
                // The last chunk has just been shown, so the whole rest counts.
                finishRef.current(words.length);
            } else {
                setCurrentIndex(end);
            }
        };
        const blinkEvery = reading.blinkEverySec * 1000;

        const tick = (ts) => {
            if (ts >= targetAt) {
                if (lastBlinkRef.current === 0) lastBlinkRef.current = ts;
                const since = ts - lastBlinkRef.current;
                const blinkDue = reading.blinkBreaks && !isCalibration && end < words.length
                    && since >= blinkEvery && (endsSentence(words[end - 1], words[end]) || since >= blinkEvery * 1.5);
                if (blinkDue) {
                    lastBlinkRef.current = ts;
                    rsvpDeadlineRef.current = targetAt + BLINK_MS;
                    setBlinking(true);
                    const blinkFrom = currentIndex;
                    blinkTimerRef.current = setTimeout(() => {
                        blinkTimerRef.current = null;
                        setBlinking(false);
                        // A jump during the blink wins: do not drag the reader back.
                        if (playingRef.current && rsvpIndexRef.current === blinkFrom) advance();
                    }, BLINK_MS);
                    return;
                }
                rsvpDeadlineRef.current = targetAt;
                advance();
                return;
            }
            frame = requestAnimationFrame(tick);
        };

        frame = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(frame);
            // Paused (or re-timed) in the middle of a blink: show the flash again.
            // A pause mid-blink shows the flash again; a speed change lets the blink finish.
            if (blinkTimerRef.current && !playingRef.current) { clearTimeout(blinkTimerRef.current); blinkTimerRef.current = null; setBlinking(false); }
        };
    }, [isPlaying, currentIndex, effectiveWpm, mode, words, settings.punctuationPacing, flashEnd, weights, gaps, paraEnds, reading.blinkBreaks, reading.blinkEverySec, isCalibration]);

    // The pacer reports completion from its own animation loop; guard against
    // it firing more than once as the final frames settle.
    const pacerDoneRef = useRef(false);
    useEffect(() => { pacerDoneRef.current = false; }, [passage, mode, pacedSeek]);

    const handlePacerComplete = useCallback(() => {
        if (pacerDoneRef.current) return;
        pacerDoneRef.current = true;
        setIsPlaying(false);
        finishRef.current(words.length);
    }, [words.length]);

    // --- Play, pause and the countdown --------------------------------------
    useEffect(() => {
        if (countdown === null) return undefined;
        const t = setTimeout(() => {
            if (countdown <= 1) { setCountdown(null); setIsPlaying(true); }
            else setCountdown(countdown - 1);
        }, 600);
        return () => clearTimeout(t);
    }, [countdown]);

    // Set once playback has started, so the first start does not rewind.
    const hasPlayedRef = useRef(false);
    useEffect(() => {
        if (!isPlaying) return;
        hasPlayedRef.current = true;
        // A pause rests the eyes, so the blink clock starts again on resume.
        lastBlinkRef.current = 0;
    }, [isPlaying]);

    const togglePlay = () => {
        if (countdown !== null) { setCountdown(null); return; }
        if (isPlaying) { setIsPlaying(false); return; }
        if (mode !== 'natural' && words.length > 0 && cursorRef.current >= words.length) seekTo(0, { auto: true });
        // Stepping back a few words on resume picks the sentence back up.
        else if (hasPlayedRef.current && reading.rewindWords > 0 && cursorRef.current > 0) seekBy(-reading.rewindWords, { auto: true });
        if (reading.countdown) setCountdown(3);
        else setIsPlaying(true);
    };

    const pause = () => { setIsPlaying(false); setCountdown(null); };

    // Auto-pause and step back slightly when the user switches tabs mid-read.
    useEffect(() => {
        const onVis = () => {
            if (!document.hidden || !isPlaying || mode === 'natural') return;
            setIsPlaying(false);
            setCountdown(null);
            const back = Math.max(4, reading.rewindWords || 0);
            if (cursorRef.current > 0) seekBy(-back, { auto: true });
            addNotification?.('Paused when tab left the foreground.');
        };
        document.addEventListener('visibilitychange', onVis);
        return () => document.removeEventListener('visibilitychange', onVis);
    }, [isPlaying, mode, reading.rewindWords, seekBy, addNotification]);

    /** - and = change the text size of whatever is on screen: the flash in RSVP, the page otherwise. */
    const resizeText = (dir) => {
        if (mode === 'rsvp') patchReading({ rsvpSizePx: reading.rsvpSizePx + dir * 4 });
        else patchReading({ proseSizePx: reading.proseSizePx + dir });
    };

    const openSettings = () => { pause(); setSettingsOpen(true); };
    const closeSettings = useCallback(() => setSettingsOpen(false), []);

    const closePopout = useCallback(() => {
        if (popoutWin && !popoutWin.closed) popoutWin.close();
        setPopoutWin(null);
    }, [popoutWin, setPopoutWin]);

    const handleWidthChange = useCallback((ch) => patchReading({ maxWidthCh: ch }), [patchReading]);
    const handleFocalChange = useCallback((pct) => patchReading({ scrollFocalPct: pct }), [patchReading]);
    const handleHeightChange = useCallback((vh) => patchReading({ scrollHeightVh: vh }), [patchReading]);

    const togglePopout = async () => {
        if (popoutWin && !popoutWin.closed) {
            closePopout();
            return;
        }
        try {
            let win = null;
            if (window.documentPictureInPicture?.requestWindow) {
                win = await window.documentPictureInPicture.requestWindow({
                    width: 760,
                    height: isScroll ? 520 : 340
                });
            } else {
                win = window.open('', 'speedai-popout', `popup=yes,width=760,height=${isScroll ? 520 : 340}`);
            }
            if (!win) {
                addNotification?.('Pop-out window was blocked by the browser.');
                return;
            }
            win.document.title = passage?.title || 'SpeedAI Reader';
            win.document.head.innerHTML = '';
            for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
                win.document.head.appendChild(node.cloneNode(true));
            }
            win.document.body.className = 'bg-slate-950 text-slate-100 m-0 p-0 overflow-hidden';
            setPopoutWin(win);
        } catch (err) {
            addNotification?.(err?.message || 'Could not open pop-out window.');
        }
    };

    useEffect(() => () => {
        if (!onPopoutChange && popoutWin && !popoutWin.closed) popoutWin.close();
    }, [onPopoutChange, popoutWin]);

    useEffect(() => {
        if (!searchOpen) return undefined;
        searchInputRef.current?.focus();
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setSearchOpen(false); } };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [searchOpen]);

    useEffect(() => {
        if (isCalibration || mode === 'natural') return undefined;
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                pause();
                setSearchOpen(true);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isCalibration, mode]);

    const searchResults = useMemo(() => {
        if (!searchOpen || !searchQuery.trim()) return [];
        const currentHits = searchTextMatches(passage?.text, searchQuery, 20).map(m => ({
            ...m,
            chapterIndex: chapterIndex,
            chapterTitle: book?.chapters?.[chapterIndex]?.title ?? null
        }));
        if (!book || book.chapters.length <= 1) return currentHits;
        const otherHits = [];
        book.chapters.forEach((ch, ci) => {
            if (ci === chapterIndex || otherHits.length >= 20) return;
            for (const m of searchTextMatches(ch.text, searchQuery, 5)) {
                otherHits.push({ ...m, chapterIndex: ci, chapterTitle: ch.title });
                if (otherHits.length >= 20) break;
            }
        });
        return [...currentHits, ...otherHits];
    }, [searchOpen, searchQuery, passage?.text, book, chapterIndex]);

    const restart = () => { pause(); seekTo(0); };

    const applyWpm = (targetWpm) => {
        const next = Math.min(2500, Math.max(100, targetWpm));
        setWpm(next);
        if (isSkim) {
            updateSettings?.({ skimWpm: next });
        } else if (separateSpeeds && (mode === 'paced' || mode === 'scroll')) {
            // Only this mode's own speed changes; the RSVP base is untouched.
            const factor = Math.round((next / Math.max(1, baseWpmRef.current)) * 10000) / 10000;
            updateSettings?.({ modeSpeedFactor: { ...(settings.modeSpeedFactor ?? {}), [mode]: factor } });
        } else {
            baseWpmRef.current = next;
            updateSettings?.(settings.autoAdaptive ? { readerWpm: next } : { readerWpm: next, baseWpm: next });
        }
    };

    const nudgeWpm = (delta) => applyWpm(wpm + delta);

    useEffect(() => {
        if (!popoutWin) return undefined;
        const onPageHide = () => setPopoutWin(null);
        const onKey = (e) => {
            if (e.key === ' ') { e.preventDefault(); if (mode !== 'natural') togglePlay(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); nudgeWpm(wpm >= 800 ? 50 : 25); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); nudgeWpm(-(wpm >= 800 ? 50 : 25)); }
            else if (e.key === '[') { e.preventDefault(); seekBy(-SKIP_WORDS); }
            else if (e.key === ']') { e.preventDefault(); seekBy(SKIP_WORDS); }
        };
        popoutWin.addEventListener('pagehide', onPageHide);
        popoutWin.addEventListener('keydown', onKey);
        return () => {
            popoutWin.removeEventListener('pagehide', onPageHide);
            popoutWin.removeEventListener('keydown', onKey);
        };
    });

    const seekSentence = (dir) => {
        if (mode === 'natural' || words.length === 0) return;
        let idx = clampIndex(cursorRef.current, words.length);
        if (dir < 0) {
            idx = Math.max(0, idx - 2);
            while (idx > 0 && !/[.!?]["'”’)\]]*$/.test(words[idx - 1])) idx--;
        } else {
            while (idx < words.length - 1 && !/[.!?]["'”’)\]]*$/.test(words[idx])) idx++;
            idx = Math.min(words.length - 1, idx + 1);
        }
        seekTo(idx);
    };

    const handleWheelScrub = (e) => {
        if (isPlaying || mode !== 'rsvp') return;
        if (Math.abs(e.deltaY) < 4) return;
        seekBy(e.deltaY > 0 ? 3 : -3);
    };

    const handleTouchStart = (e) => {
        if (isPlaying || e.touches.length !== 1) return;
        touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };

    const handleTouchEnd = (e) => {
        const start = touchStartRef.current;
        touchStartRef.current = null;
        if (!start || isPlaying || e.changedTouches.length !== 1) return;
        const dx = e.changedTouches[0].clientX - start.x;
        const dy = e.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) {
            seekBy(dx < 0 ? SKIP_WORDS : -SKIP_WORDS);
        }
    };

    // You read with your eyes fixed on one point, so reaching for the mouse to
    // pause defeats the exercise.
    const wpmStep = wpm >= 800 ? 50 : 25;
    useHotkeys({
        ' ': () => { if (mode !== 'natural') togglePlay(); },
        ArrowUp: () => nudgeWpm(wpmStep),
        ArrowRight: () => nudgeWpm(wpmStep),
        ArrowDown: () => nudgeWpm(-wpmStep),
        ArrowLeft: () => nudgeWpm(-wpmStep),
        '[': () => seekBy(-SKIP_WORDS),
        ']': () => seekBy(SKIP_WORDS),
        '{': () => seekSentence(-1),
        '}': () => seekSentence(1),
        r: () => { if (mode !== 'natural') restart(); },
        z: () => patchReading({ zen: !reading.zen }),
        s: () => openSettings(),
        b: () => { if (mode !== 'natural' && onBookmark) { pause(); setBookmarkNote(''); setBookmarkOpen(true); } },
        '/': () => { if (mode !== 'natural') { pause(); setSearchOpen(true); } },
        f: () => toggleFullscreen(),
        '-': () => resizeText(-1),
        '=': () => resizeText(1),
        '+': () => resizeText(1),
        Escape: () => { if (searchOpen) setSearchOpen(false); else if (bookmarkOpen) setBookmarkOpen(false); else if (wpmMenuOpen) setWpmMenuOpen(false); else onExit?.(); },
        ...(reading.remoteControls ? {
            // Presentation clickers and page-turners send these keys.
            PageDown: () => { if (mode !== 'natural') togglePlay(); },
            PageUp: () => seekBy(-SKIP_WORDS),
            MediaPlayPause: () => { if (mode !== 'natural') togglePlay(); },
            MediaTrackNext: () => seekSentence(1),
            MediaTrackPrevious: () => seekSentence(-1)
        } : {})
    }, !quizActive && !settingsOpen && !bookmarkOpen && !searchOpen && !isCalibration && !checkpoint && !quizWriting);

    // Gamepads (polled; the Gamepad API has no button events): A or Start
    // play/pause, B back, D-pad up/down speed, shoulder buttons a sentence back or on.
    const padRef = useRef({ enabled: false, actions: {} });
    useLayoutEffect(() => {
        padRef.current = {
            enabled: !quizActive && !settingsOpen && !bookmarkOpen && !searchOpen && !checkpoint && !quizWriting,
            actions: {
                toggle: () => { if (mode !== 'natural') togglePlay(); },
                back: () => seekBy(-SKIP_WORDS),
                faster: () => nudgeWpm(wpmStep),
                slower: () => nudgeWpm(-wpmStep),
                prevSentence: () => seekSentence(-1),
                nextSentence: () => seekSentence(1)
            }
        };
    });
    useEffect(() => {
        if (!reading.remoteControls || isCalibration || typeof navigator === 'undefined' || !navigator.getGamepads) return undefined;
        const BUTTONS = [[0, 'toggle'], [9, 'toggle'], [1, 'back'], [12, 'faster'], [13, 'slower'], [4, 'prevSentence'], [5, 'nextSentence']];
        const wasDown = new Map();
        const id = setInterval(() => {
            for (const pad of navigator.getGamepads()) {
                if (!pad) continue;
                for (const [b, action] of BUTTONS) {
                    const down = Boolean(pad.buttons[b]?.pressed);
                    const key = `${pad.index}:${b}`;
                    if (down && !wasDown.get(key) && padRef.current.enabled) padRef.current.actions[action]?.();
                    wasDown.set(key, down);
                }
            }
        }, 50);
        return () => clearInterval(id);
    }, [reading.remoteControls, isCalibration]);

    const renderRsvpChunk = () => {
        if (blinking) return null;
        const chunkWords = words.slice(currentIndex, flashEnd(currentIndex));
        if (chunkWords.length === 0) return null;
        const focal = focalColorFor(reading);
        const spanMode = reading.focalSpan ?? 'single';
        const isGrad = spanMode === 'gradient';
        const flankOpacity = reading.rsvpFlankOpacity ?? 0.8;

        if (chunkWords.length > 1) {
            // A phrase is taken in as a whole, centred on the fixation point.
            const scale = MULTI_SCALE[Math.min(Math.max(settings.chunkSize, chunkWords.length), 5)] ?? 0.56;
            const joined = joinFlashWords(chunkWords);
            const parts = joined.split(' ');
            const midWordIdx = Math.floor(parts.length / 2);
            let offset = 0;
            for (let i = 0; i < midWordIdx; i++) offset += parts[i].length + 1;
            const midRange = focalRange(parts[midWordIdx], spanMode);
            const midStart = offset + midRange.start;
            const midCenter = offset + midRange.center;
            const midEnd = offset + midRange.end;

            return (
                <div className="w-full select-none px-5 md:px-8 flex items-center justify-center">
                    <p
                        className="text-center m-0"
                        style={{
                            fontSize: `calc(var(--reading-rsvp-size) * ${scale})`,
                            fontFamily: 'var(--reading-font)',
                            lineHeight: 1.2,
                            fontWeight: reading.rsvpWeight,
                            wordSpacing: 'calc(0.08em + var(--reading-word-spacing, 0em))',
                            letterSpacing: 'var(--reading-letter-spacing, 0)',
                            textWrap: 'balance',
                            overflowWrap: 'anywhere',
                            maxWidth: '100%'
                        }}
                    >
                        {spanMode === 'allOrps' ? (
                            parts.map((pw, wi) => {
                                const cIdx = orpIndex(pw);
                                return (
                                    <span key={wi}>
                                        {wi > 0 ? ' ' : ''}
                                        <span style={{ opacity: flankOpacity }}>{pw.slice(0, cIdx)}</span>
                                        <span className="font-bold" style={{ color: focal ?? 'inherit' }}>{pw.charAt(cIdx)}</span>
                                        <span style={{ opacity: flankOpacity }}>{pw.slice(cIdx + 1)}</span>
                                    </span>
                                );
                            })
                        ) : (
                            <>
                                <span style={{ opacity: isGrad ? Math.max(flankOpacity, 0.85) : flankOpacity, color: isGrad && focal ? focal : undefined }}>
                                    {joined.slice(0, midStart)}
                                </span>
                                {midStart < midCenter && (
                                    <span className="font-bold" style={{ color: focal ?? 'inherit', opacity: 0.88 }}>
                                        {joined.slice(midStart, midCenter)}
                                    </span>
                                )}
                                <span className="font-bold" style={{ color: focal ?? 'inherit' }}>{joined.charAt(midCenter)}</span>
                                {midCenter + 1 < midEnd && (
                                    <span className="font-bold" style={{ color: focal ?? 'inherit', opacity: 0.88 }}>
                                        {joined.slice(midCenter + 1, midEnd)}
                                    </span>
                                )}
                                <span style={{ opacity: isGrad ? Math.max(flankOpacity, 0.85) : flankOpacity, color: isGrad && focal ? focal : undefined }}>
                                    {joined.slice(midEnd)}
                                </span>
                            </>
                        )}
                    </p>
                </div>
            );
        }

        const chunk = chunkWords[0];
        const range = focalRange(chunk, spanMode);
        const pre = chunk.slice(0, range.start);
        const leftCluster = chunk.slice(range.start, range.center);
        const center = chunk.charAt(range.center);
        const rightCluster = chunk.slice(range.center + 1, range.end);
        const post = chunk.slice(range.end);
        const scale = rsvpWordScale(chunk);

        return (
            // Equal-width flanks keep the ORP character pinned to the exact
            // horizontal centre without the halves overlapping it, for 1 or more words.
            <div
                className="flex items-center justify-center w-full select-none px-4"
                style={{
                    fontSize: scale === 1 ? 'var(--reading-rsvp-size)' : `calc(var(--reading-rsvp-size) * ${scale})`,
                    fontFamily: 'var(--reading-font)',
                    lineHeight: 1.15,
                    fontWeight: reading.rsvpWeight
                }}
            >
                <span className="flex-1 min-w-0 text-right whitespace-pre" style={{ opacity: isGrad ? Math.max(flankOpacity, 0.85) : flankOpacity }}>
                    {isGrad && focal ? <span style={{ color: focal, opacity: 0.55 }}>{pre}</span> : pre}
                    {leftCluster && <span className="font-bold" style={{ color: focal ?? 'inherit', opacity: 0.85 }}>{leftCluster}</span>}
                </span>
                <span className="shrink-0 font-bold" style={{ color: focal ?? 'inherit' }}>{center}</span>
                <span className="flex-1 min-w-0 text-left whitespace-pre" style={{ opacity: isGrad ? Math.max(flankOpacity, 0.85) : flankOpacity }}>
                    {rightCluster && <span className="font-bold" style={{ color: focal ?? 'inherit', opacity: 0.85 }}>{rightCluster}</span>}
                    {isGrad && focal ? <span style={{ color: focal, opacity: 0.55 }}>{post}</span> : post}
                </span>
            </div>
        );
    };

    /** The coming group, faint and small under the flash, so the eyes are ready for it. */
    const renderNextPreview = () => {
        if (!reading.rsvpPreviewNext) return null;
        const end = flashEnd(currentIndex);
        if (end >= words.length) return <p aria-hidden="true" className="m-0" style={{ fontSize: 'calc(var(--reading-rsvp-size) * 0.32)' }}>&nbsp;</p>;
        return (
            <p
                aria-hidden="true"
                className="m-0 text-center select-none px-6 truncate max-w-full"
                style={{
                    fontSize: 'calc(var(--reading-rsvp-size) * 0.32)',
                    fontFamily: 'var(--reading-font)',
                    color: 'var(--reading-muted)',
                    lineHeight: 1.2
                }}
            >
                {joinFlashWords(words.slice(end, flashEnd(end)))}
            </p>
        );
    };

    /** The words immediately before and after the flash, shown above and below it. */
    const CONTEXT_WORDS = 16;
    const beforeContext = useMemo(() => {
        const from = Math.max(0, currentIndex - CONTEXT_WORDS);
        return {
            hasMore: from > 0,
            items: words.slice(from, currentIndex).map((word, i) => ({ word, index: from + i }))
        };
    }, [words, currentIndex]);

    const afterContext = useMemo(() => {
        const start = flashEnd(currentIndex);
        const to = Math.min(words.length, start + CONTEXT_WORDS);
        return {
            hasMore: to < words.length,
            items: words.slice(start, to).map((word, i) => ({ word, index: start + i }))
        };
    }, [words, currentIndex, flashEnd]);

    if (!passage) return <div className="text-center mt-20 text-slate-400">No passage loaded.</div>;

    // The quiz and its review screen are shared with the speed-push drill.
    if (quizActive && pending) {
        return (
            <Quiz
                questions={questions}
                ctaLabel={isCalibration ? 'Save Baseline' : isSkim ? 'Log Skim' : 'Log Session'}
                resultSubtitle={() => `read at ${pending.wpm} WPM`}
                resultNote={(score) => {
                    if (isCalibration) return 'This sets your baseline and starting target speed.';
                    if (isSkim) {
                        return gistQuestions.length > 0
                            ? 'Skims are tracked separately and never move your reading target.'
                            : 'These were detail questions, which a skim is not meant to catch. Tracked separately; your reading target is untouched.';
                    }
                    return score >= 90
                        ? 'Comfortable at this speed — your target moves up.'
                        : score >= 70
                            ? 'In the training band. Target speed holds here.'
                            : 'Retention is slipping. Target speed eases back.';
                }}
                onDone={(score) => { leaveRef.current.finished = true; onFinish({ ...pending, score }); }}
            />
        );
    }

    const zenHidden = reading.zen && isPlaying;
    const left = clock(((words.length - cursorIndex) / Math.max(1, effectiveWpm)) * 60);

    const transport = mode !== 'natural' && !isCalibration && (
        <div className="flex items-center justify-center gap-3 md:gap-5">
            <button onClick={restart} aria-label="Restart from the beginning" title="Restart (R)" className="p-3 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
                <RotateCcw size={20} />
            </button>
            <button onClick={() => seekBy(-SKIP_WORDS)} aria-label={`Back ${SKIP_WORDS} words`} title="Back ([)" className="p-3 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
                <SkipBack size={22} />
            </button>
            <button
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 ${isPlaying ? 'bg-slate-800 text-slate-300' : 'bg-purple-600 text-white shadow-purple-900/30'}`}
            >
                {isPlaying ? <Pause size={32} /> : <Play size={32} className="ml-2" />}
            </button>
            <button onClick={() => seekBy(SKIP_WORDS)} aria-label={`Skip ${SKIP_WORDS} words`} title="Skip (])" className="p-3 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
                <SkipForward size={22} />
            </button>
            <button onClick={toggleFullscreen} aria-label={isFullscreen ? 'Leave full screen' : 'Full screen'} title="Full screen (F)" className="p-3 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
                {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
            </button>
        </div>
    );

    const renderTimeline = () => {
        if (isCalibration) return null;

        if (book && book.chapters.length > 1 && Number.isInteger(chapterIndex)) {
            const totalCh = book.chapters.length;
            const prevDisabled = chapterIndex <= 0;
            const nextDisabled = chapterIndex >= totalCh - 1;
            const jumpChapter = (idx) => {
                pause();
                leaveRef.current.finished = true;
                onSelectChapter?.(idx, { progressIndex: cursorRef.current, mode });
            };
            return (
                <div className="w-full max-w-2xl mt-3 pt-3 border-t border-slate-800/70">
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <button
                            type="button"
                            disabled={prevDisabled}
                            onClick={() => jumpChapter(chapterIndex - 1)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none px-2 py-1 rounded-lg hover:bg-slate-800/60"
                        >
                            <ChevronLeft size={14} /> Prev
                        </button>
                        <span className="text-xs font-medium text-slate-400 truncate">
                            Chapter {chapterIndex + 1} of {totalCh} · <span className="text-slate-200">{book.chapters[chapterIndex]?.title}</span>
                        </span>
                        <button
                            type="button"
                            disabled={nextDisabled}
                            onClick={() => jumpChapter(chapterIndex + 1)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none px-2 py-1 rounded-lg hover:bg-slate-800/60"
                        >
                            Next <ChevronRight size={14} />
                        </button>
                    </div>
                    <div className="flex gap-1.5 overflow-x-auto pb-1" role="navigation" aria-label="Chapter timeline">
                        {book.chapters.map((ch, i) => {
                            const active = i === chapterIndex;
                            const done = Boolean(ch.completedAt);
                            return (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => jumpChapter(i)}
                                    title={`${ch.title} (${ch.words.toLocaleString()} words)`}
                                    aria-current={active ? 'step' : undefined}
                                    className={`shrink-0 max-w-[11rem] truncate px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                                        active
                                            ? 'border-purple-500 bg-purple-500/20 text-purple-200'
                                            : done
                                                ? 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300 hover:border-emerald-600'
                                                : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                                    }`}
                                >
                                    {i + 1}. {ch.title}
                                </button>
                            );
                        })}
                    </div>
                </div>
            );
        }

        if (sections.length === 0 || mode === 'natural') return null;

        let activeSectionIdx = 0;
        for (let i = 0; i < sections.length; i++) {
            if (cursorIndex >= sections[i].index) activeSectionIdx = i;
        }

        return (
            <div className="w-full max-w-2xl mt-3 pt-3 border-t border-slate-800/70">
                <div className="flex gap-1.5 overflow-x-auto pb-1 justify-start sm:justify-center" role="navigation" aria-label="Document timeline">
                    {sections.map((sec, i) => {
                        const active = i === activeSectionIdx;
                        return (
                            <button
                                key={`${sec.index}-${i}`}
                                type="button"
                                onClick={() => seekTo(sec.index)}
                                title={`Jump to ${sec.title} (word ${sec.index + 1})`}
                                aria-current={active ? 'step' : undefined}
                                className={`shrink-0 max-w-[11rem] truncate px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                                    active
                                        ? 'border-purple-500 bg-purple-500/20 text-purple-200'
                                        : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                                }`}
                            >
                                {sec.title}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    };

    const pctDone = words.length ? Math.round((cursorIndex / words.length) * 100) : 0;
    const status = (
        <p className="text-slate-500 text-sm font-mono text-center">
            {pctDone}% · {cursorIndex} / {words.length} · {left} left · {clock(elapsedSecs)} read
            {ramp < 1 && <span className="text-amber-400"> · warming up {Math.round(ramp * 100)}%</span>}
            {checkStats.asked > 0 && <span className="text-emerald-400/80"> · checks {checkStats.right}/{checkStats.asked}</span>}
        </p>
    );

    return (
        <ReadingSurface reading={reading} paint={false} className="h-full flex flex-col relative animate-in fade-in pb-6">
            <header
                className={`flex items-center justify-between bg-slate-900 border border-slate-800 p-3 md:p-4 rounded-2xl mb-6 flex-wrap gap-3 transition-opacity duration-300 ${zenHidden ? 'opacity-0 hover:opacity-100 focus-within:opacity-100' : ''}`}
            >
                <button onClick={() => onExit?.()} className="text-slate-400 hover:text-white font-medium text-sm mr-1">← Exit</button>
                {isCalibration ? (
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400"><Target size={18} /></div>
                        <div>
                            <div className="font-bold text-white text-sm">{passage.title}</div>
                            <div className="text-xs text-slate-400">Read at your normal pace — no pacing, no speed control. Then answer {questions.length} questions.</div>
                        </div>
                    </div>
                ) : (
                    <div className="flex gap-1 overflow-x-auto">
                        {[
                            ['rsvp', 'RSVP'],
                            ['paced', 'Paced'],
                            ['natural', 'Natural'],
                            ['skim', 'Skim']
                        ].map(([key, label]) => (
                            <button
                                key={key}
                                onClick={() => switchMode(key)}
                                className={`px-3 md:px-4 py-2 rounded-lg font-bold text-sm transition-colors whitespace-nowrap ${mode === key ? 'bg-purple-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                )}

                <div className="flex items-center gap-2 md:gap-3 ml-auto">
                    {mode !== 'natural' && !isCalibration && (
                        <>
                            {settings.audioSyncEnabled && mode === 'rsvp' && (
                                <button
                                    onClick={() => { addNotification('Audio sync ready.'); setIsAudioReady(true); }}
                                    className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${isAudioReady ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                                >
                                    <Volume2 size={16} className={isAudioReady && isPlaying ? 'animate-pulse' : ''} />
                                    {isAudioReady ? 'Audio linked' : 'Link audio'}
                                </button>
                            )}
                            <div className="relative" ref={wpmMenuRef}>
                                <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                                    <button onClick={() => nudgeWpm(-25)} aria-label="Slower" className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"><Minus size={16} /></button>
                                    <button
                                        type="button"
                                        onClick={() => setWpmMenuOpen(o => !o)}
                                        aria-expanded={wpmMenuOpen}
                                        aria-label="Choose WPM preset"
                                        title="Click for speed presets"
                                        className="px-2 md:px-3 py-1.5 font-mono font-bold text-purple-400 hover:text-purple-300 min-w-[76px] text-center text-sm transition-colors"
                                    >
                                        {wpm} WPM
                                        {accelBonus > 0 && <span className="ml-1 text-emerald-400" title="Speed builder">+{accelBonus}</span>}
                                        {slowFactor < 1 && <span className="ml-1 text-amber-400" title="Shift held">{reading.holdSlowPct}%</span>}
                                    </button>
                                    <button onClick={() => nudgeWpm(25)} aria-label="Faster" className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"><Plus size={16} /></button>
                                </div>
                                {wpmMenuOpen && (
                                    <div className="absolute right-0 mt-2 w-36 bg-slate-900 border border-slate-700 rounded-xl shadow-xl p-1.5 z-30 grid grid-cols-1 gap-0.5" role="menu" aria-label="WPM presets">
                                        {WPM_PRESETS.map(preset => (
                                            <button
                                                key={preset}
                                                type="button"
                                                role="menuitem"
                                                onClick={() => { applyWpm(preset); setWpmMenuOpen(false); }}
                                                className={`text-left px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-colors ${
                                                    wpm === preset ? 'bg-purple-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                                                }`}
                                            >
                                                {preset} WPM
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => switchMode(isScroll ? lastNonScrollModeRef.current : 'scroll')}
                                aria-pressed={isScroll}
                                title="Scroll mode — text scrolls up from the bottom"
                                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-colors ${
                                    isScroll
                                        ? 'border-purple-500 bg-purple-600 text-white'
                                        : 'border-slate-800 bg-slate-950 text-slate-300 hover:text-white hover:border-slate-600'
                                }`}
                            >
                                <ArrowUpDown size={15} />
                                <span className="hidden sm:inline">Scroll</span>
                            </button>
                        </>
                    )}
                    {mode !== 'natural' && !isCalibration && (
                        <button
                            type="button"
                            onClick={() => { pause(); setSearchOpen(true); }}
                            aria-label="Search in text"
                            title="Search & jump (/ or Ctrl+F)"
                            className="p-2.5 rounded-xl border border-slate-800 text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
                        >
                            <Search size={18} />
                        </button>
                    )}
                    {onBookmark && mode !== 'natural' && (
                        <button
                            onClick={() => { pause(); setBookmarkNote(''); setBookmarkOpen(true); }} aria-label="Bookmark this spot" title="Bookmark & note (B)"
                            className="p-2.5 rounded-xl border border-slate-800 text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
                        >
                            <Bookmark size={18} />
                        </button>
                    )}
                    {(mode === 'rsvp' || isScroll) && !isCalibration && (
                        <button
                            type="button"
                            onClick={togglePopout}
                            aria-pressed={Boolean(popoutWin && !popoutWin.closed)}
                            title={popoutWin && !popoutWin.closed ? 'Dock pop-out window back' : 'Pop out floating reader window'}
                            className={`p-2.5 rounded-xl border transition-colors ${
                                popoutWin && !popoutWin.closed
                                    ? 'border-purple-500 bg-purple-600/20 text-purple-200'
                                    : 'border-slate-800 text-slate-300 hover:text-white hover:border-slate-600'
                            }`}
                        >
                            <ExternalLink size={18} />
                        </button>
                    )}
                    <button
                        onClick={openSettings} aria-label="Reading settings" title="Reading settings (S)"
                        className="p-2.5 rounded-xl border border-slate-800 text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
                    >
                        <Settings2 size={18} />
                    </button>
                </div>
            </header>

            <div className="flex-1 flex flex-col justify-center items-center relative">
                {countdown !== null && (
                    <div className="absolute inset-0 z-10 grid place-items-center pointer-events-none" aria-live="assertive">
                        <span key={countdown} className="text-7xl font-black text-white/90 animate-in zoom-in-50 fade-in duration-300">{countdown}</span>
                    </div>
                )}

                {popoutWin && !popoutWin.closed && (mode === 'rsvp' || isScroll) ? (
                    <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900/90 p-8 text-center space-y-4">
                        <div className="text-sm font-bold text-white">Reading in floating pop-out window</div>
                        <p className="text-xs text-slate-400">
                            {pctDone}% · {cursorIndex} / {words.length} words · {effectiveWpm} WPM
                        </p>
                        <div className="flex items-center justify-center gap-3">
                            <button
                                type="button"
                                onClick={togglePlay}
                                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-colors"
                            >
                                {isPlaying ? 'Pause' : 'Play'}
                            </button>
                            <button
                                type="button"
                                onClick={closePopout}
                                className="px-4 py-2 rounded-xl border border-slate-700 hover:border-slate-500 text-slate-200 text-xs font-bold transition-colors"
                            >
                                Dock back
                            </button>
                        </div>
                    </div>
                ) : mode === 'rsvp' ? (
                    <div className="w-full flex flex-col items-center">
                        <div
                            onWheel={handleWheelScrub}
                            onTouchStart={handleTouchStart}
                            onTouchEnd={handleTouchEnd}
                            className="w-full rounded-2xl overflow-hidden flex flex-col items-center"
                            style={{ background: 'var(--reading-bg)', color: 'var(--reading-fg)' }}
                        >
                            {reading.rsvpContext && (
                                <div
                                    aria-hidden="true"
                                    className={`h-16 md:h-20 w-full max-w-2xl px-6 pt-3 pb-1 flex items-end justify-center overflow-hidden select-none transition-opacity duration-200 ${
                                        isPlaying && reading.rsvpContextPlay === 'hide'
                                            ? 'opacity-0 pointer-events-none'
                                            : isPlaying && reading.rsvpContextPlay === 'dim'
                                                ? 'opacity-25'
                                                : 'opacity-100'
                                    }`}
                                    style={{
                                        maskImage: 'linear-gradient(to bottom, transparent 0%, black 55%)',
                                        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 55%)'
                                    }}
                                >
                                    <p
                                        className="text-center leading-relaxed"
                                        style={{
                                            color: 'var(--reading-muted)',
                                            fontFamily: 'var(--reading-font)',
                                            fontSize: 'clamp(0.875rem, calc(var(--reading-prose-size) * 0.85), 1.3rem)'
                                        }}
                                    >
                                        {beforeContext.hasMore && <span className="opacity-50 mr-1">…</span>}
                                        {beforeContext.items.map(({ word, index }) => (
                                            // Clicking a word is a mouse shortcut; [ and ] are the keyboard path.
                                            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                                            <span
                                                key={index}
                                                onClick={() => seekTo(index)}
                                                className="cursor-pointer hover:underline"
                                            >
                                                {word}{' '}
                                            </span>
                                        ))}
                                    </p>
                                </div>
                            )}
                            <button
                                type="button"
                                onClick={togglePlay}
                                aria-label={isPlaying ? 'Pause reading' : 'Start reading'}
                                className="flex items-center justify-center w-full relative overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 border-y border-slate-800/40"
                                style={{ height: reading.rsvpPreviewNext ? `calc(${flashBoxHeight(settings.chunkSize)} + 2.4rem)` : flashBoxHeight(settings.chunkSize) }}
                            >
                                {reading.showFocalGuide && (
                                    <>
                                        <div className="absolute top-0 left-1/2 w-0.5 h-3 -translate-x-1/2 pointer-events-none rounded-b" style={{ background: 'var(--reading-muted)', opacity: 0.55 }} />
                                        <div className="absolute bottom-0 left-1/2 w-0.5 h-3 -translate-x-1/2 pointer-events-none rounded-t" style={{ background: 'var(--reading-muted)', opacity: 0.55 }} />
                                    </>
                                )}
                                {paraEnds.has(flashEnd(currentIndex) - 1) && (
                                    <span
                                        aria-hidden="true"
                                        title="End of paragraph"
                                        className="absolute bottom-2 right-3 text-xs font-mono pointer-events-none"
                                        style={{ color: 'var(--reading-muted)', opacity: 0.6 }}
                                    >
                                        ¶
                                    </span>
                                )}
                                {countdown === null && (
                                    <div className="w-full flex flex-col items-center gap-2">
                                        {renderRsvpChunk()}
                                        {renderNextPreview()}
                                    </div>
                                )}
                            </button>
                            {reading.rsvpContext && (
                                <div
                                    aria-hidden="true"
                                    className={`h-16 md:h-20 w-full max-w-2xl px-6 pt-1 pb-3 flex items-start justify-center overflow-hidden select-none transition-opacity duration-200 ${
                                        isPlaying && reading.rsvpContextPlay === 'hide'
                                            ? 'opacity-0 pointer-events-none'
                                            : isPlaying && reading.rsvpContextPlay === 'dim'
                                                ? 'opacity-25'
                                                : 'opacity-100'
                                    }`}
                                    style={{
                                        maskImage: 'linear-gradient(to top, transparent 0%, black 55%)',
                                        WebkitMaskImage: 'linear-gradient(to top, transparent 0%, black 55%)'
                                    }}
                                >
                                    <p
                                        className="text-center leading-relaxed"
                                        style={{
                                            color: 'var(--reading-muted)',
                                            fontFamily: 'var(--reading-font)',
                                            fontSize: 'clamp(0.875rem, calc(var(--reading-prose-size) * 0.85), 1.3rem)'
                                        }}
                                    >
                                        {afterContext.items.map(({ word, index }) => (
                                            // Clicking a word is a mouse shortcut; [ and ] are the keyboard path.
                                            // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                                            <span
                                                key={index}
                                                onClick={() => seekTo(index)}
                                                className="cursor-pointer hover:underline"
                                            >
                                                {word}{' '}
                                            </span>
                                        ))}
                                        {afterContext.hasMore && <span className="opacity-50">…</span>}
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="w-full flex flex-col items-center gap-2 mt-10">
                            <Scrubber index={cursorIndex} total={words.length} onSeek={seekTo} label="Reading position" heat={heat} />
                            {reading.speedTrace && <SpeedTraceLine trace={trace} />}
                            {status}
                            {renderTimeline()}
                            <p className="text-slate-600 text-xs">Target {wpm} WPM · actual pace is measured and recorded</p>
                            {!isCalibration && <KeyboardHint />}
                        </div>
                    </div>
                ) : isScroll ? (
                    <div
                        onWheel={handleWheelScrub}
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        className="w-full h-full border border-slate-800/40 rounded-3xl p-5 md:p-10 flex flex-col justify-between"
                        style={{ background: 'var(--reading-bg)', color: 'var(--reading-fg)' }}
                    >
                        <div className="flex items-center justify-between gap-3 border-b pb-3 mb-4" style={{ borderColor: 'var(--reading-muted)' }}>
                            <h2 className="text-lg md:text-xl font-bold truncate" style={{ color: 'var(--reading-fg)', opacity: 0.95 }}>{passage.title}</h2>
                            <button
                                type="button"
                                onClick={togglePlay}
                                className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors"
                            >
                                {isPlaying ? 'Pause' : 'Start scroll'}
                            </button>
                        </div>

                        <ScrollText
                            text={passage.text}
                            wpm={effectiveWpm}
                            isRunning={isPlaying}
                            reading={reading}
                            rank={reading.rarityPacing ? rank : null}
                            difficulty={reading.scrollEaseHard ? difficulty : null}
                            bionicReading={settings.bionicReading}
                            initialIndex={pacedInitialIndex}
                            seek={pacedSeek}
                            onWordClick={seekTo}
                            onProgress={setPacedIndex}
                            onComplete={handlePacerComplete}
                            onChangeWidth={handleWidthChange}
                            onChangeFocalPct={handleFocalChange}
                            onChangeHeightVh={handleHeightChange}
                        />

                        <div className="mt-6 pt-4 border-t border-slate-800 flex flex-col items-center gap-2">
                            <Scrubber index={cursorIndex} total={words.length} onSeek={seekTo} label="Reading position" heat={heat} />
                            {reading.speedTrace && <SpeedTraceLine trace={trace} />}
                            {status}
                            {renderTimeline()}
                            <p className="text-xs text-center" style={{ color: 'var(--reading-muted)' }}>
                                Text scrolls upward at {effectiveWpm} WPM. Click any word to jump there, or press Space to pause.
                            </p>
                            {!isCalibration && <KeyboardHint />}
                        </div>
                    </div>
                ) : isPacer ? (
                    <div className="w-full h-full border border-slate-800/40 rounded-3xl p-6 md:p-12 overflow-y-auto" style={{ background: 'var(--reading-bg)', color: 'var(--reading-fg)' }}>
                        <h2 className="text-2xl font-bold mb-6 border-b pb-4" style={{ color: 'var(--reading-fg)', borderColor: 'var(--reading-muted)', opacity: 0.95 }}>{passage.title}</h2>
                        {isSkim && (
                            <p className="text-sm mb-6 -mt-2" style={{ color: 'var(--reading-muted)' }}>
                                Skimming: let your eyes ride the cursor and pick up the shape of the argument, not every word.
                                {gistQuestions.length > 0 ? ' You will be asked about the gist.' : ' This passage has no gist questions, so the check uses its detail questions.'}
                            </p>
                        )}

                        <PacedText
                            key={mode}
                            text={passage.text}
                            wpm={effectiveWpm}
                            isRunning={isPlaying}
                            bionicReading={settings.bionicReading}
                            bionicStrength={reading.bionicStrength}
                            pacerStyle={reading.pacerStyle}
                            dimRead={reading.dimRead}
                            readOpacity={reading.readOpacity}
                            initialIndex={pacedInitialIndex}
                            seek={pacedSeek}
                            onWordClick={seekTo}
                            onProgress={setPacedIndex}
                            onComplete={handlePacerComplete}
                            onChangeWidth={(ch) => patchReading({ maxWidthCh: ch })}
                        />

                        <div className="mt-10 pt-6 border-t border-slate-800 flex flex-col items-center gap-2">
                            <Scrubber index={cursorIndex} total={words.length} onSeek={seekTo} label="Reading position" heat={heat} />
                            {reading.speedTrace && <SpeedTraceLine trace={trace} />}
                            {status}
                            {renderTimeline()}
                            <p className="text-xs text-center" style={{ color: 'var(--reading-muted)' }}>
                                {isSkim
                                    ? 'Sample, do not read: headings, first lines, names and numbers.'
                                    : 'Keep pace with the cursor. Do not go back — that is the habit this drill is breaking. Click a word to jump there.'}
                            </p>
                            {!isCalibration && <KeyboardHint />}
                        </div>
                    </div>
                ) : (
                    <div className="w-full h-full border border-slate-800/40 rounded-3xl p-6 md:p-12 overflow-y-auto" style={{ background: 'var(--reading-bg)', color: 'var(--reading-fg)' }}>
                        {!naturalStarted ? (
                            <div className="max-w-md mx-auto text-center py-12">
                                <div className="inline-flex p-3 bg-purple-500/20 rounded-2xl text-purple-400 mb-6"><Target size={28} /></div>
                                <h2 className="text-2xl font-bold mb-3" style={{ color: 'var(--reading-fg)' }}>{passage.title}</h2>
                                <p className="leading-relaxed mb-2" style={{ color: 'var(--reading-fg)', opacity: 0.8 }}>
                                    {isCalibration
                                        ? 'Read at your natural pace — no pacing, no speed control. Do not try to go fast; this is measuring where you actually are.'
                                        : 'Read at your own pace. Timing runs from the moment you begin until you press Finished Reading.'}
                                </p>
                                <p className="text-sm mb-8" style={{ color: 'var(--reading-muted)' }}>{words.length} words{questions.length > 0 && `, then ${questions.length} questions`}</p>
                                <button
                                    onClick={() => setNaturalStarted(true)}
                                    className="bg-purple-600 hover:bg-purple-500 text-white px-8 py-4 rounded-xl font-bold transition-colors inline-flex items-center gap-2"
                                >
                                    <Play size={18} className="fill-current" /> Begin reading
                                </button>
                                <p className="text-xs mt-4" style={{ color: 'var(--reading-muted)' }}>The clock starts when you press this.</p>
                            </div>
                        ) : (
                            <>
                                <h2 className="text-2xl font-bold mb-6 border-b pb-4" style={{ color: 'var(--reading-fg)', borderColor: 'var(--reading-muted)', opacity: 0.95 }}>{passage.title}</h2>
                                <PassageText text={passage.text} bionicReading={settings.bionicReading} reading={reading} />

                                <div className="mt-12 pt-8 border-t border-slate-800 flex flex-col items-center gap-3">
                                    <button onClick={() => handleFinishReading()} className="bg-purple-600 hover:bg-purple-500 text-white px-8 py-4 rounded-xl font-bold transition-all">
                                        Finished Reading
                                    </button>
                                    <p className="text-xs" style={{ color: 'var(--reading-muted)' }}>{words.length} words</p>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {transport && (
                <div className={`pt-6 mt-auto transition-opacity duration-300 ${zenHidden ? 'opacity-30 hover:opacity-100' : ''}`}>
                    {transport}
                </div>
            )}

            <ReaderSettings
                open={settingsOpen} onClose={closeSettings} mode={mode}
                reading={reading} patchReading={patchReading}
                settings={settings} updateSettings={updateSettings}
                customPresets={customPresets} onSavePresets={onSavePresets}
            />
            {checkpoint && (
                <CheckpointCard
                    checkpoint={checkpoint}
                    stats={checkStats}
                    onAnswer={answerCheckpoint}
                    onContinue={continueAfterCheckpoint}
                    onSkip={skipCheckpoint}
                    onTurnOff={() => { patchReading({ checkpoints: false }); skipCheckpoint(); addNotification?.('Checkpoints off. Turn them back on in reading settings.'); }}
                />
            )}

            {quizWriting && (
                <div className="fixed inset-0 z-[56] grid place-items-center p-4 bg-black/50">
                    <div role="dialog" aria-label="Writing a quiz" className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl text-center space-y-3">
                        <p className="font-bold text-white">Writing a quiz for this chapter…</p>
                        <p className="text-xs text-slate-400">So the chapter counts as measured training. The questions are saved with the chapter.</p>
                        <button
                            type="button"
                            onClick={() => {
                                quizWritingCancelledRef.current = true;
                                setQuizWriting(false);
                                leaveRef.current.finished = true;
                                onFinish({ ...pending, score: null });
                            }}
                            className="text-sm text-slate-300 hover:text-white underline"
                        >
                            Skip the quiz
                        </button>
                    </div>
                </div>
            )}

            {searchOpen && (
                <div className="fixed inset-0 z-[60] grid place-items-start justify-center p-4 pt-20">
                    <button aria-label="Close search" className="absolute inset-0 bg-black/50" onClick={() => setSearchOpen(false)} />
                    <div
                        role="dialog"
                        aria-label="Search in document"
                        className="relative w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl p-4 shadow-2xl space-y-3"
                    >
                        <div className="flex items-center gap-2">
                            <Search size={16} className="text-purple-400 shrink-0" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={book && book.chapters.length > 1 ? 'Search this chapter or entire book…' : 'Search text to jump…'}
                                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                            />
                            <button type="button" onClick={() => setSearchOpen(false)} aria-label="Close search" className="p-2 text-slate-400 hover:text-white">
                                <X size={16} />
                            </button>
                        </div>
                        {searchQuery.trim() && (
                            <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
                                {searchResults.length === 0 ? (
                                    <p className="text-xs text-slate-500 py-4 text-center">No matches found.</p>
                                ) : (
                                    searchResults.map((m, i) => (
                                        <button
                                            key={`${m.chapterIndex ?? 'p'}-${m.index}-${i}`}
                                            type="button"
                                            onClick={() => {
                                                setSearchOpen(false);
                                                if (Number.isInteger(m.chapterIndex) && m.chapterIndex !== chapterIndex && onSelectChapter) {
                                                    onSelectChapter(m.chapterIndex, { progressIndex: cursorRef.current, mode });
                                                } else {
                                                    seekTo(m.index);
                                                }
                                            }}
                                            className="w-full text-left bg-slate-950/70 hover:border-purple-500 border border-slate-800 rounded-xl px-3 py-2 transition-colors"
                                        >
                                            <div className="flex items-center justify-between text-[11px] text-purple-300 font-mono mb-0.5">
                                                <span>{m.chapterTitle ? `${m.chapterTitle} · ` : ''}Word {m.index + 1}</span>
                                                {Number.isInteger(m.chapterIndex) && m.chapterIndex !== chapterIndex && (
                                                    <span className="text-slate-500">Opens chapter</span>
                                                )}
                                            </div>
                                            <div className="text-xs text-slate-300 line-clamp-2">{m.snippet}</div>
                                        </button>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
            {popoutWin && !popoutWin.closed && (mode === 'rsvp' || isScroll) && createPortal(
                <ReadingSurface reading={reading} className="h-screen w-screen flex flex-col justify-between p-4 select-none">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800/60 shrink-0">
                        <span className="text-xs font-bold truncate" style={{ color: 'var(--reading-fg)' }}>{passage.title}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                            <button type="button" onClick={() => nudgeWpm(-(wpm >= 800 ? 50 : 25))} className="px-2 py-1 rounded bg-slate-800/80 text-slate-200 text-xs font-bold hover:bg-slate-700">-</button>
                            <span className="text-xs font-mono font-bold px-1.5" style={{ color: 'var(--reading-fg)' }}>{effectiveWpm} WPM</span>
                            <button type="button" onClick={() => nudgeWpm(wpm >= 800 ? 50 : 25)} className="px-2 py-1 rounded bg-slate-800/80 text-slate-200 text-xs font-bold hover:bg-slate-700">+</button>
                            <button
                                type="button"
                                onClick={togglePlay}
                                className="px-3 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold"
                            >
                                {isPlaying ? 'Pause' : 'Play'}
                            </button>
                            <button
                                type="button"
                                onClick={closePopout}
                                className="px-2.5 py-1 rounded border border-slate-700 text-slate-300 hover:text-white text-xs font-bold"
                            >
                                Dock
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 flex flex-col justify-center items-center min-h-0 overflow-hidden">
                        {mode === 'rsvp' ? (
                            <button
                                type="button"
                                onClick={togglePlay}
                                aria-label={isPlaying ? 'Pause reading' : 'Start reading'}
                                className="flex items-center justify-center w-full h-full relative overflow-hidden cursor-pointer focus:outline-none"
                            >
                                {reading.showFocalGuide && (
                                    <>
                                        <div className="absolute top-0 left-1/2 w-0.5 h-3 -translate-x-1/2 pointer-events-none rounded-b" style={{ background: 'var(--reading-muted)', opacity: 0.55 }} />
                                        <div className="absolute bottom-0 left-1/2 w-0.5 h-3 -translate-x-1/2 pointer-events-none rounded-t" style={{ background: 'var(--reading-muted)', opacity: 0.55 }} />
                                    </>
                                )}
                                <div className="w-full flex flex-col items-center gap-2">
                                    {renderRsvpChunk()}
                                    {renderNextPreview()}
                                </div>
                            </button>
                        ) : (
                            <ScrollText
                                text={passage.text}
                                wpm={effectiveWpm}
                                isRunning={isPlaying}
                                reading={{ ...reading, scrollHeightVh: 76 }}
                                rank={reading.rarityPacing ? rank : null}
                                difficulty={reading.scrollEaseHard ? difficulty : null}
                                bionicReading={settings.bionicReading}
                                initialIndex={pacedInitialIndex}
                                seek={pacedSeek}
                                onWordClick={seekTo}
                                onProgress={setPacedIndex}
                                onComplete={handlePacerComplete}
                                onChangeWidth={(ch) => patchReading({ maxWidthCh: ch })}
                                onChangeFocalPct={(pct) => patchReading({ scrollFocalPct: pct })}
                            />
                        )}
                    </div>
                    <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] font-mono shrink-0" style={{ color: 'var(--reading-muted)' }}>
                        <span>{pctDone}% · {cursorIndex} / {words.length}</span>
                        <span>{left} left</span>
                    </div>
                </ReadingSurface>,
                popoutWin.document.body
            )}

            {bookmarkOpen && (
                <div className="fixed inset-0 z-[60] grid place-items-center p-4">
                    <button aria-label="Close bookmark dialog" className="absolute inset-0 bg-black/50" onClick={() => setBookmarkOpen(false)} />
                    <form
                        role="dialog"
                        aria-label="Add bookmark and note"
                        onSubmit={(e) => {
                            e.preventDefault();
                            onBookmark?.({ index: cursorRef.current, note: bookmarkNote });
                            setBookmarkOpen(false);
                            setBookmarkNote('');
                        }}
                        className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5 shadow-2xl space-y-4"
                    >
                        <div className="flex items-center gap-2 text-white font-bold">
                            <Bookmark size={17} className="text-amber-400" />
                            <span>Save bookmark &amp; note</span>
                        </div>
                        <p className="text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 line-clamp-2">
                            &ldquo;{words.slice(cursorIndex, cursorIndex + 14).join(' ')}&rdquo;
                        </p>
                        <div>
                            <label htmlFor="bm-note" className="block text-xs font-bold text-slate-400 mb-1.5">Note (optional)</label>
                            <input
                                ref={bookmarkInputRef}
                                id="bm-note"
                                type="text"
                                value={bookmarkNote}
                                onChange={(e) => setBookmarkNote(e.target.value)}
                                placeholder="Key takeaway, question, or reminder..."
                                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500"
                            />
                        </div>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setBookmarkOpen(false)}
                                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 rounded-xl text-sm font-bold bg-purple-600 hover:bg-purple-500 text-white"
                            >
                                Save bookmark
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </ReadingSurface>
    );
}

export default Reader;
