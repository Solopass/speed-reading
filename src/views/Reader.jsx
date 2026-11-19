import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    Bookmark, Maximize2, Minimize2, Minus, Pause, Play, Plus, RotateCcw, Settings2, SkipBack, SkipForward, Target, Volume2
} from 'lucide-react';
import { normalizeQuestions } from '../lib/quiz';
import useHotkeys from '../lib/useHotkeys';
import PacedText from '../components/PacedText';
import PassageText from '../components/PassageText';
import ReadingSurface from '../components/ReadingSurface';
import ReaderSettings from '../components/ReaderSettings';
import { focalColorFor, rampFactor } from '../lib/readingStyle';
import { clampIndex, clock, jump, startCount, wordsCovered } from '../lib/readerNav';
import Quiz from '../components/Quiz';

/** Words skipped by the rewind and skip controls. */
const SKIP_WORDS = 10;

const Kbd = ({ children }) => <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400 font-mono">{children}</kbd>;

function KeyboardHint() {
    return (
        <p className="text-[11px] text-slate-600 mt-2 flex items-center justify-center gap-x-3 gap-y-1 flex-wrap">
            <span><Kbd>space</Kbd> play/pause</span>
            <span><Kbd>↑↓</Kbd> speed</span>
            <span><Kbd>[ ]</Kbd> back/skip {SKIP_WORDS}</span>
            <span><Kbd>R</Kbd> restart</span>
            <span><Kbd>S</Kbd> settings</span>
            <span><Kbd>B</Kbd> bookmark (books)</span>
            <span><Kbd>F</Kbd> full screen</span>
            <span><Kbd>esc</Kbd> exit</span>
        </p>
    );
}

/** Skimming starts well past reading speed: below ~700 WPM it is just fast reading. */
export const skimStartWpm = (targetWpm) => Math.min(2000, Math.max(700, Math.round((targetWpm * 2.5) / 50) * 50));

/**
 * Clickable progress bar. Clicking or using the arrow keys on it jumps the
 * reading position; the word count stays honest because the Reader banks what
 * was covered before every jump.
 */
function Scrubber({ index, total, onSeek, label }) {
    const pct = total ? (index / total) * 100 : 0;
    const seekFromPointer = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - rect.left) / rect.width) * total);
    };
    return (
        <div
            role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={index}
            onClick={seekFromPointer}
            onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); onSeek(index - SKIP_WORDS); }
                if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); onSeek(index + SKIP_WORDS); }
            }}
            className="group w-full max-w-lg py-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 rounded"
        >
            <div className="h-2 group-hover:h-3 transition-all bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-purple-600 transition-[width] duration-200" style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

function Reader({
    passage, settings, reading, patchReading, updateSettings, initialWpm, resumeFrom = 0,
    onFinish, onLeave, onExit, onBookmark = null, addNotification
}) {
    // The baseline test measures your natural pace, so it is always read as
    // ordinary text with no pacing and no speed control.
    const isCalibration = passage?.isCalibration === true;

    const [readWpm, setReadWpm] = useState(initialWpm);
    // Skim runs at its own speed, so trying a skim and switching back does not
    // leave the reading speed at 1,000 WPM.
    const [skimWpm, setSkimWpm] = useState(() => skimStartWpm(initialWpm));
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(resumeFrom);
    const [mode, setMode] = useState(isCalibration ? 'natural' : 'rsvp');
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

    const [pacedIndex, setPacedIndex] = useState(0);
    const [pacedSeek, setPacedSeek] = useState(null);

    const isSkim = mode === 'skim';
    const isPacer = mode === 'paced' || mode === 'skim';
    const wpm = isSkim ? skimWpm : readWpm;
    const setWpm = isSkim ? setSkimWpm : setReadWpm;

    const words = useMemo(() => {
        if (!passage?.text) return [];
        return passage.text.trim().split(/\s+/).filter(w => w.length > 0);
    }, [passage]);

    // Validated and shuffled once per passage: a model can return a bad answer
    // index or duplicate options, and re-shuffling on every render would move
    // the options under the reader's cursor.
    const detailQuestions = useMemo(() => normalizeQuestions(passage?.questions), [passage]);
    // A skim is checked on gist when the passage came with gist questions.
    // Otherwise it falls back to the detail questions, which is harsh on a
    // skim, so those sessions are still kept out of the reading averages.
    const gistQuestions = useMemo(() => normalizeQuestions(passage?.gistQuestions), [passage]);
    const questions = isSkim && gistQuestions.length > 0 ? gistQuestions : detailQuestions;

    // Where the reader is now, in whichever mode is running.
    const cursorIndex = mode === 'rsvp' ? Math.min(currentIndex, words.length) : Math.min(pacedIndex, words.length);

    // The warm-up ramp eases the speed in over the first quarter. Quantised to
    // 5% steps so the pacer is not re-timed on every single word.
    const ramp = Math.round(rampFactor(words.length ? cursorIndex / words.length : 1, reading.speedRamp && !isCalibration) * 20) / 20;
    const effectiveWpm = Math.round(wpm * ramp);

    const timerRef = useRef(null);

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

        const chunk = words.slice(currentIndex, currentIndex + settings.chunkSize).join(' ');
        if (!chunk) return;

        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.rate = Math.min(4, Math.max(0.5, effectiveWpm / 180));
        synth.cancel();
        synth.speak(utterance);
    }, [currentIndex, isPlaying, isAudioReady, mode, effectiveWpm, words, settings.audioSyncEnabled, settings.chunkSize]);

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
        return Math.min(2000, Math.max(50, Math.round(wordsRead / (ms / 60000))));
    }, [elapsedMs, wpm]);

    // Words covered *this sitting*, banked across every rewind and skip (see
    // readerNav.js). Resuming at word 200 counts from 200; Natural mode has no
    // cursor, so the whole passage counts.
    const countRef = useRef(startCount(resumeFrom));
    const wordsRead = useCallback(() => {
        if (mode === 'natural') return words.length;
        return wordsCovered(countRef.current, cursorIndex);
    }, [mode, cursorIndex, words.length]);

    /**
     * Switching modes starts the measurement over: each mode counts words on
     * its own basis, and carrying the elapsed time across a switch would divide
     * one mode's words by another mode's seconds.
     */
    const modeStartedRef = useRef(mode);
    useEffect(() => {
        if (modeStartedRef.current === mode) return;
        modeStartedRef.current = mode;
        accumulatedMsRef.current = 0;
        runningSinceRef.current = null;
        setElapsedSecs(0);
        countRef.current = startCount(mode === 'rsvp' ? currentIndex : 0);
        setPacedIndex(0);
        setPacedSeek(null);
    }, [mode, currentIndex]);

    // The live position for jumps. Updated on every render and immediately by
    // each jump, so two jumps in quick succession chain instead of both
    // starting from the same stale position (which would over-credit words).
    const cursorRef = useRef(cursorIndex);
    useLayoutEffect(() => { cursorRef.current = cursorIndex; });

    /** Jump to a word, in RSVP or the pacers. */
    const seekTo = useCallback((target) => {
        if (mode === 'natural' || words.length === 0) return;
        const to = clampIndex(target, words.length);
        countRef.current = jump(countRef.current, cursorRef.current, to);
        cursorRef.current = to;
        if (mode === 'rsvp') setCurrentIndex(to);
        else {
            setPacedIndex(to);
            setPacedSeek(prev => ({ index: to, nonce: (prev?.nonce ?? 0) + 1 }));
        }
    }, [mode, words.length]);

    const seekBy = useCallback((delta) => seekTo(cursorRef.current + delta), [seekTo]);

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

    const handleFinishReading = useCallback(() => {
        stopClock();
        const measured = {
            wpm: measuredWpm(wordsRead()), words: wordsRead(), elapsedMs: elapsedMs(),
            mode: isCalibration ? 'natural' : mode
        };
        if (questions.length > 0) {
            setPending(measured);
            setQuizActive(true);
            return;
        }
        leaveRef.current.finished = true;
        onFinish({ ...measured, score: null });
    }, [stopClock, wordsRead, questions, onFinish, measuredWpm, elapsedMs, mode, isCalibration]);

    // --- RSVP advance ------------------------------------------------------
    useEffect(() => {
        if (!isPlaying || mode !== 'rsvp' || words.length === 0 || currentIndex >= words.length) return;

        const currentChunk = words.slice(currentIndex, currentIndex + settings.chunkSize);
        let delayMs = (60000 / effectiveWpm) * settings.chunkSize;

        if (settings.punctuationPacing && currentChunk.length > 0) {
            const lastWord = currentChunk[currentChunk.length - 1];
            if (lastWord.endsWith(',')) delayMs += 150;
            else if (lastWord.endsWith('.') || lastWord.endsWith('!') || lastWord.endsWith('?')) delayMs += 300;
        }

        timerRef.current = setTimeout(() => {
            const next = currentIndex + settings.chunkSize;
            if (next >= words.length) {
                setCurrentIndex(words.length);
                setIsPlaying(false);
                handleFinishReading();
            } else {
                setCurrentIndex(next);
            }
        }, delayMs);

        return () => clearTimeout(timerRef.current);
    }, [isPlaying, currentIndex, effectiveWpm, mode, words, settings.punctuationPacing, settings.chunkSize, handleFinishReading]);

    // The pacer reports completion from its own animation loop; guard against
    // it firing more than once as the final frames settle.
    const pacerDoneRef = useRef(false);
    useEffect(() => { pacerDoneRef.current = false; }, [passage, mode, pacedSeek]);

    const handlePacerComplete = useCallback(() => {
        if (pacerDoneRef.current) return;
        pacerDoneRef.current = true;
        setIsPlaying(false);
        handleFinishReading();
    }, [handleFinishReading]);

    // --- Play, pause and the countdown --------------------------------------
    useEffect(() => {
        if (countdown === null) return undefined;
        const t = setTimeout(() => {
            if (countdown <= 1) { setCountdown(null); setIsPlaying(true); }
            else setCountdown(countdown - 1);
        }, 600);
        return () => clearTimeout(t);
    }, [countdown]);

    const togglePlay = () => {
        if (countdown !== null) { setCountdown(null); return; }
        if (isPlaying) { setIsPlaying(false); return; }
        if (mode === 'rsvp' && words.length > 0 && currentIndex >= words.length) seekTo(0);
        if (reading.countdown) setCountdown(3);
        else setIsPlaying(true);
    };

    const pause = () => { setIsPlaying(false); setCountdown(null); };

    const openSettings = () => { pause(); setSettingsOpen(true); };
    const closeSettings = useCallback(() => setSettingsOpen(false), []);

    const restart = () => { pause(); seekTo(0); };

    const nudgeWpm = (delta) => setWpm(w => Math.min(2000, Math.max(100, w + delta)));

    // You read with your eyes fixed on one point, so reaching for the mouse to
    // pause defeats the exercise.
    useHotkeys({
        ' ': () => { if (mode !== 'natural') togglePlay(); },
        ArrowUp: () => nudgeWpm(25),
        ArrowRight: () => nudgeWpm(25),
        ArrowDown: () => nudgeWpm(-25),
        ArrowLeft: () => nudgeWpm(-25),
        '[': () => seekBy(-SKIP_WORDS),
        ']': () => seekBy(SKIP_WORDS),
        r: () => { if (mode !== 'natural') restart(); },
        s: () => openSettings(),
        b: () => { if (mode !== 'natural') onBookmark?.({ index: cursorRef.current }); },
        f: () => toggleFullscreen(),
        Escape: () => onExit?.()
    }, !quizActive && !settingsOpen && !isCalibration);

    const renderRsvpChunk = () => {
        if (settings.chunkSize === 1) {
            const word = words[currentIndex];
            if (!word) return null;
            const centerIdx = word.length <= 1 ? 0 : Math.max(0, Math.floor(word.length / 2) - 1);

            const start = word.slice(0, centerIdx);
            const center = word.charAt(centerIdx);
            const end = word.slice(centerIdx + 1);

            return (
                // Equal-width flanks keep the ORP character pinned to the exact
                // horizontal centre without the halves overlapping it.
                <div
                    className="flex items-center justify-center w-full select-none"
                    style={{ fontSize: 'var(--reading-rsvp-size)', fontFamily: 'var(--reading-font)', lineHeight: 1.1 }}
                >
                    <span className="flex-1 text-right whitespace-pre" style={{ opacity: 0.8 }}>{start}</span>
                    <span className="shrink-0 font-bold" style={{ color: focalColorFor(reading) ?? 'inherit' }}>{center}</span>
                    <span className="flex-1 text-left whitespace-pre" style={{ opacity: 0.8 }}>{end}</span>
                </div>
            );
        }
        const chunk = words.slice(currentIndex, currentIndex + settings.chunkSize).join(' ');
        return (
            <div
                className="w-full text-center select-none font-bold leading-tight px-4"
                style={{ fontSize: 'calc(var(--reading-rsvp-size) * 0.7)', fontFamily: 'var(--reading-font)' }}
            >
                {chunk}
            </div>
        );
    };

    /** The words immediately before and after the flash, shown above and below it. */
    const CONTEXT_WORDS = 18;
    const beforeWords = useMemo(() => {
        const from = Math.max(0, currentIndex - CONTEXT_WORDS);
        const slice = words.slice(from, currentIndex).join(' ');
        if (!slice) return '';
        return (from > 0 ? '… ' : '') + slice;
    }, [words, currentIndex]);

    const afterWords = useMemo(() => {
        const start = Math.min(words.length, currentIndex + settings.chunkSize);
        const to = Math.min(words.length, start + CONTEXT_WORDS);
        const slice = words.slice(start, to).join(' ');
        if (!slice) return '';
        return slice + (to < words.length ? ' …' : '');
    }, [words, currentIndex, settings.chunkSize]);

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

    const status = (
        <p className="text-slate-500 text-sm font-mono text-center">
            {cursorIndex} / {words.length} · {left} left · {clock(elapsedSecs)} read
            {ramp < 1 && <span className="text-amber-400"> · warming up {Math.round(ramp * 100)}%</span>}
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
                                onClick={() => { pause(); setNaturalStarted(false); setMode(key); }}
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
                            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                                <button onClick={() => nudgeWpm(-25)} aria-label="Slower" className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"><Minus size={16} /></button>
                                <div className="px-2 md:px-3 font-mono font-bold text-purple-400 min-w-[76px] text-center text-sm">{wpm} WPM</div>
                                <button onClick={() => nudgeWpm(25)} aria-label="Faster" className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"><Plus size={16} /></button>
                            </div>
                        </>
                    )}
                    {onBookmark && mode !== 'natural' && (
                        <button
                            onClick={() => onBookmark({ index: cursorRef.current })} aria-label="Bookmark this spot" title="Bookmark (B)"
                            className="p-2.5 rounded-xl border border-slate-800 text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
                        >
                            <Bookmark size={18} />
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

                {mode === 'rsvp' ? (
                    <div className="w-full flex flex-col items-center">
                        <div
                            className="w-full rounded-2xl overflow-hidden flex flex-col items-center"
                            style={{ background: 'var(--reading-bg)', color: 'var(--reading-fg)' }}
                        >
                            {reading.rsvpContext && (
                                <div
                                    aria-hidden="true"
                                    className="h-14 md:h-16 w-full max-w-2xl px-6 pt-3 pb-1 flex items-end justify-center overflow-hidden select-none pointer-events-none"
                                >
                                    <p
                                        className="text-sm md:text-base text-center leading-relaxed line-clamp-2"
                                        style={{ color: 'var(--reading-muted)', fontFamily: 'var(--reading-font)', opacity: 0.8 }}
                                    >
                                        {beforeWords}
                                    </p>
                                </div>
                            )}
                            <button
                                type="button"
                                onClick={togglePlay}
                                aria-label={isPlaying ? 'Pause reading' : 'Start reading'}
                                className="h-36 md:h-40 flex items-center justify-center w-full relative overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 rounded-2xl"
                            >
                                {reading.showFocalGuide && (
                                    <div className="absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 pointer-events-none" style={{ background: 'var(--reading-muted)', opacity: 0.35 }} />
                                )}
                                {countdown === null && renderRsvpChunk()}
                            </button>
                            {reading.rsvpContext && (
                                <div
                                    aria-hidden="true"
                                    className="h-14 md:h-16 w-full max-w-2xl px-6 pt-1 pb-3 flex items-start justify-center overflow-hidden select-none pointer-events-none"
                                >
                                    <p
                                        className="text-sm md:text-base text-center leading-relaxed line-clamp-2"
                                        style={{ color: 'var(--reading-muted)', fontFamily: 'var(--reading-font)', opacity: 0.8 }}
                                    >
                                        {afterWords}
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="w-full flex flex-col items-center gap-2 mt-10">
                            <Scrubber index={cursorIndex} total={words.length} onSeek={seekTo} label="Reading position" />
                            {status}
                            <p className="text-slate-600 text-xs">Target {wpm} WPM · actual pace is measured and recorded</p>
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
                            seek={pacedSeek}
                            onWordClick={seekTo}
                            onProgress={setPacedIndex}
                            onComplete={handlePacerComplete}
                        />

                        <div className="mt-10 pt-6 border-t border-slate-800 flex flex-col items-center gap-2">
                            <Scrubber index={cursorIndex} total={words.length} onSeek={seekTo} label="Reading position" />
                            {status}
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
                                    <button onClick={handleFinishReading} className="bg-purple-600 hover:bg-purple-500 text-white px-8 py-4 rounded-xl font-bold transition-all">
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
            />
        </ReadingSurface>
    );
}

export default Reader;
