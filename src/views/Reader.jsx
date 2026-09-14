import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Pause, Play, Plus, Target, Volume2 } from 'lucide-react';
import { normalizeQuestions } from '../lib/quiz';
import useHotkeys from '../lib/useHotkeys';
import PacedText from '../components/PacedText';
import PassageText from '../components/PassageText';
import ReadingSurface from '../components/ReadingSurface';
import { focalColorFor } from '../lib/readingStyle';
import Quiz from '../components/Quiz';

function KeyboardHint() {
    return (
        <p className="text-[11px] text-slate-600 mt-2 flex items-center justify-center gap-3 flex-wrap">
            <span><kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400 font-mono">space</kbd> play/pause</span>
            <span><kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400 font-mono">↑↓</kbd> speed</span>
            <span><kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400 font-mono">esc</kbd> exit</span>
        </p>
    );
}

function Reader({ passage, settings, reading, initialWpm, resumeFrom = 0, onFinish, onLeave, onExit, addNotification }) {
    // The baseline test measures your natural pace, so it is always read as
    // ordinary text with no pacing and no speed control.
    const isCalibration = passage?.isCalibration === true;

    const [wpm, setWpm] = useState(initialWpm);
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

    const [pacedIndex, setPacedIndex] = useState(0);

    const words = useMemo(() => {
        if (!passage?.text) return [];
        return passage.text.trim().split(/\s+/).filter(w => w.length > 0);
    }, [passage]);

    // Validated and shuffled once per passage: a model can return a bad answer
    // index or duplicate options, and re-shuffling on every render would move
    // the options under the reader's cursor.
    const questions = useMemo(() => normalizeQuestions(passage?.questions), [passage]);

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
            if (hidden) setIsPlaying(false);
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, []);

    // RSVP and Paced run the clock while playing; Natural runs it the whole
    // time the text is on screen, which is the only way to measure it there.
    // Either way a hidden tab stops it.
    useEffect(() => {
        if (!isHidden && ((mode === 'natural' && naturalStarted) || isPlaying)) startClock();
        else stopClock();
    }, [mode, naturalStarted, isPlaying, isHidden, startClock, stopClock]);

    useEffect(() => stopClock, [stopClock]);

    // --- Audio sync --------------------------------------------------------
    // One utterance per flash, cancelling the previous one, so speech can never
    // lag behind the visual. Speaking the whole remaining passage as a single
    // utterance (as this once did) drifts apart within a few words.
    useEffect(() => {
        if (!settings.audioSyncEnabled || !isAudioReady || mode !== 'rsvp' || !isPlaying) return;

        const chunk = words.slice(currentIndex, currentIndex + settings.chunkSize).join(' ');
        if (!chunk) return;

        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.rate = Math.min(4, Math.max(0.5, wpm / 180));
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    }, [currentIndex, isPlaying, isAudioReady, mode, wpm, words, settings.audioSyncEnabled, settings.chunkSize]);

    useEffect(() => {
        if (!isPlaying || mode !== 'rsvp') window.speechSynthesis.cancel();
    }, [isPlaying, mode]);

    useEffect(() => () => window.speechSynthesis.cancel(), []);

    // --- RSVP advance ------------------------------------------------------
    useEffect(() => {
        if (!isPlaying || mode !== 'rsvp' || currentIndex >= words.length) return;

        const currentChunk = words.slice(currentIndex, currentIndex + settings.chunkSize);
        let delayMs = (60000 / wpm) * settings.chunkSize;

        if (settings.punctuationPacing && currentChunk.length > 0) {
            const lastWord = currentChunk[currentChunk.length - 1];
            if (lastWord.endsWith(',')) delayMs += 150;
            else if (lastWord.endsWith('.') || lastWord.endsWith('!') || lastWord.endsWith('?')) delayMs += 300;
        }

        timerRef.current = setTimeout(() => {
            setCurrentIndex(prev => prev + settings.chunkSize);
        }, delayMs);

        return () => clearTimeout(timerRef.current);
    }, [isPlaying, currentIndex, wpm, mode, words, settings.punctuationPacing, settings.chunkSize]);

    /**
     * Measured speed over the words actually read. Clamped because a Natural-mode
     * reader who hits "Finished" immediately would otherwise record a fantasy number.
     */
    const measuredWpm = useCallback((wordsRead) => {
        const ms = elapsedMs();
        if (ms < 500 || wordsRead <= 0) return wpm;
        return Math.min(2000, Math.max(50, Math.round(wordsRead / (ms / 60000))));
    }, [elapsedMs, wpm]);

    // Words covered *this sitting*. Resuming at word 200 must not count those
    // 200 towards a speed the clock only measured the remainder of. Natural
    // mode has no cursor to read from, so the whole passage counts.
    const resumedAt = useRef(resumeFrom);
    const wordsRead = useCallback(() => {
        if (mode === 'rsvp') return Math.max(0, Math.min(currentIndex, words.length) - resumedAt.current);
        if (mode === 'paced') return Math.min(pacedIndex, words.length);
        return words.length;
    }, [mode, currentIndex, pacedIndex, words.length]);

    /**
     * Switching modes starts the measurement over.
     *
     * The clock runs for the whole sitting, but each mode counts words on its
     * own basis: Paced and Natural both begin at the first word again, and RSVP
     * counts from wherever its cursor is. Carrying the elapsed time across a
     * switch therefore divides one mode's words by another mode's seconds —
     * try RSVP for half a minute, decide you prefer Paced, and the session is
     * recorded well below the speed you actually read at, which then drags the
     * adaptive target down with it.
     */
    const modeStartedRef = useRef(mode);
    useEffect(() => {
        if (modeStartedRef.current === mode) return;
        modeStartedRef.current = mode;
        accumulatedMsRef.current = 0;
        runningSinceRef.current = null;
        resumedAt.current = mode === 'rsvp' ? currentIndex : 0;
        setPacedIndex(0);
    }, [mode, currentIndex]);

    // Position within the whole passage, for the library's resume point.
    const absoluteIndex = mode === 'rsvp' ? currentIndex : pacedIndex;
    const leaveRef = useRef({ onLeave, passageId: passage?.id, absoluteIndex, finished: false });
    leaveRef.current = { ...leaveRef.current, onLeave, passageId: passage?.id, absoluteIndex };

    // Navigating away mid-passage saves where you got to; finishing does not,
    // since completing already resets the resume point.
    useEffect(() => () => {
        const { onLeave: leave, passageId, absoluteIndex: at, finished } = leaveRef.current;
        if (!finished) leave?.({ passageId, progressIndex: at });
    }, []);

    const handleFinishReading = useCallback(() => {
        stopClock();
        const measured = { wpm: measuredWpm(wordsRead()), words: wordsRead(), elapsedMs: elapsedMs() };
        if (questions.length > 0) {
            setPending(measured);
            setQuizActive(true);
            return;
        }
        leaveRef.current.finished = true;
        onFinish({ ...measured, score: null });
    }, [stopClock, wordsRead, questions, onFinish, measuredWpm, elapsedMs]);

    // Completion lives in its own effect so the advance effect doesn't have to
    // close over a handler it never lists as a dependency.
    const finishRef = useRef(handleFinishReading);
    finishRef.current = handleFinishReading;

    // The pacer reports completion from its own animation loop; guard against
    // it firing more than once as the final frames settle.
    const pacerDoneRef = useRef(false);
    useEffect(() => { pacerDoneRef.current = false; }, [passage, mode]);

    const handlePacerComplete = useCallback(() => {
        if (pacerDoneRef.current) return;
        pacerDoneRef.current = true;
        setIsPlaying(false);
        finishRef.current();
    }, []);

    useEffect(() => {
        if (isPlaying && mode === 'rsvp' && words.length > 0 && currentIndex >= words.length) {
            setIsPlaying(false);
            finishRef.current();
        }
    }, [isPlaying, mode, currentIndex, words.length]);

    const togglePlay = () => setIsPlaying(!isPlaying);

    const nudgeWpm = (delta) => setWpm(w => Math.min(2000, Math.max(100, w + delta)));

    // You read with your eyes fixed on one point, so reaching for the mouse to
    // pause defeats the exercise.
    useHotkeys({
        ' ': () => { if (mode !== 'natural') togglePlay(); },
        ArrowUp: () => nudgeWpm(25),
        ArrowRight: () => nudgeWpm(25),
        ArrowDown: () => nudgeWpm(-25),
        ArrowLeft: () => nudgeWpm(-25),
        Escape: () => onExit?.()
    }, !quizActive && !isCalibration);

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
                    <span className="shrink-0 font-bold" style={{ color: focalColorFor(reading) }}>{center}</span>
                    <span className="flex-1 text-left whitespace-pre" style={{ opacity: 0.8 }}>{end}</span>
                </div>
            );
        } else {
            const chunk = words.slice(currentIndex, currentIndex + settings.chunkSize).join(' ');
            return (
                <div
                    className="w-full text-center select-none font-bold leading-tight px-4"
                    style={{ fontSize: 'calc(var(--reading-rsvp-size) * 0.7)', fontFamily: 'var(--reading-font)' }}
                >
                    {chunk}
                </div>
            );
        }
    };

    if (!passage) return <div className="text-center mt-20 text-slate-400">No passage loaded.</div>;

    // The quiz and its review screen are shared with the speed-push drill.
    if (quizActive && pending) {
        return (
            <Quiz
                questions={questions}
                ctaLabel={isCalibration ? 'Save Baseline' : 'Log Session'}
                resultSubtitle={() => `read at ${pending.wpm} WPM`}
                resultNote={(score) => {
                    if (isCalibration) return 'This sets your baseline and starting target speed.';
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

    return (
        <ReadingSurface reading={reading} paint={false} className="h-full flex flex-col relative animate-in fade-in pb-12">
            <header className="flex items-center justify-between bg-slate-900 border border-slate-800 p-4 rounded-2xl mb-8 flex-wrap gap-4">
                {!isCalibration && (
                    <button onClick={() => onExit?.()} className="text-slate-400 hover:text-white font-medium text-sm mr-2">← Exit</button>
                )}
                {isCalibration ? (
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400"><Target size={18} /></div>
                        <div>
                            <div className="font-bold text-white text-sm">Baseline Test</div>
                            <div className="text-xs text-slate-400">Read at your normal pace — no pacing, no speed control. Then answer {questions.length} questions.</div>
                        </div>
                    </div>
                ) : (
                    <div className="flex gap-2">
                        {[
                            ['rsvp', 'RSVP'],
                            ['paced', 'Paced'],
                            ['natural', 'Natural']
                        ].map(([key, label]) => (
                            <button
                                key={key}
                                onClick={() => { setIsPlaying(false); setNaturalStarted(false); setMode(key); }}
                                className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${mode === key ? 'bg-purple-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                )}

                {mode !== 'natural' && !isCalibration && (
                    <div className="flex items-center gap-4 ml-auto">
                        {settings.audioSyncEnabled && mode === 'rsvp' && (
                            <button
                                onClick={() => { addNotification("Audio Sync Ready"); setIsAudioReady(true); }}
                                className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${isAudioReady ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                            >
                                <Volume2 size={16} className={isAudioReady && isPlaying ? "animate-pulse" : ""} />
                                {isAudioReady ? 'Audio Linked' : 'Link Audio'}
                            </button>
                        )}
                        <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                            <button onClick={() => setWpm(w => Math.max(100, w - 25))} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"><Minus size={16}/></button>
                            <div className="px-4 font-mono font-bold text-purple-400 min-w-[80px] text-center">{wpm} WPM</div>
                            <button onClick={() => setWpm(w => Math.min(2000, w + 25))} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"><Plus size={16}/></button>
                        </div>
                    </div>
                )}
            </header>

            <div className="flex-1 flex flex-col justify-center items-center">
                {mode === 'rsvp' ? (
                    <div className="w-full flex flex-col items-center">
                        <button
                            type="button"
                            onClick={togglePlay}
                            aria-label={isPlaying ? 'Pause reading' : 'Start reading'}
                            className="h-40 flex items-center justify-center w-full relative overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 rounded-2xl"
                            style={{ background: 'var(--reading-bg)', color: 'var(--reading-fg)' }}
                        >
                            {reading.showFocalGuide && (
                                <div className="absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 pointer-events-none" style={{ background: "var(--reading-muted)", opacity: 0.35 }} />
                            )}
                            {renderRsvpChunk()}
                        </button>

                        <div className="w-full max-w-lg mt-12 bg-slate-900 h-2 rounded-full overflow-hidden">
                            <div className="h-full bg-purple-600 transition-all duration-200" style={{ width: `${words.length ? (currentIndex / words.length) * 100 : 0}%` }}></div>
                        </div>
                        <p className="text-slate-500 text-sm mt-4 font-mono">{currentIndex} / {words.length}</p>
                        <p className="text-slate-600 text-xs mt-1">Target {wpm} WPM · actual pace is measured and recorded</p>
                        {!isCalibration && <KeyboardHint />}
                    </div>
                ) : mode === 'paced' ? (
                    <div className="w-full h-full border border-slate-800/40 rounded-3xl p-8 md:p-12 overflow-y-auto" style={{ background: 'var(--reading-bg)', color: 'var(--reading-fg)' }}>
                        <h2 className="text-2xl font-bold mb-6 border-b pb-4" style={{ color: 'var(--reading-fg)', borderColor: 'var(--reading-muted)', opacity: 0.95 }}>{passage.title}</h2>

                        <PacedText
                            text={passage.text}
                            wpm={wpm}
                            isRunning={isPlaying}
                            bionicReading={settings.bionicReading}
                            onProgress={setPacedIndex}
                            onComplete={handlePacerComplete}
                        />

                        <div className="mt-10 pt-6 border-t border-slate-800 flex flex-col items-center gap-3">
                            <div className="w-full max-w-lg bg-slate-950 h-2 rounded-full overflow-hidden">
                                <div className="h-full bg-purple-600" style={{ width: `${words.length ? (pacedIndex / words.length) * 100 : 0}%` }} />
                            </div>
                            <p className="text-slate-500 text-sm font-mono">{pacedIndex} / {words.length} · {wpm} WPM</p>
                            <p className="text-xs" style={{ color: 'var(--reading-muted)' }}>Keep pace with the cursor. Do not go back — that is the habit this drill is breaking.</p>
                            {!isCalibration && <KeyboardHint />}
                        </div>
                    </div>
                ) : (
                    <div className="w-full h-full border border-slate-800/40 rounded-3xl p-8 md:p-12 overflow-y-auto" style={{ background: 'var(--reading-bg)', color: 'var(--reading-fg)' }}>
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

            {mode !== 'natural' && (
                <div className="py-8 flex justify-center mt-auto">
                    <button
                        onClick={togglePlay}
                        className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 ${isPlaying ? 'bg-slate-800 text-slate-300' : 'bg-purple-600 text-white shadow-purple-900/30'}`}
                    >
                        {isPlaying ? <Pause size={32} /> : <Play size={32} className="ml-2" />}
                    </button>
                </div>
            )}
        </ReadingSurface>
    );
}

export default Reader;
