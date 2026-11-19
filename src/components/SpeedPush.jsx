import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Maximize2, Minimize2, Pause, Play, Settings2, Zap } from 'lucide-react';
import PacedText from './PacedText';
import ReadingSurface from './ReadingSurface';
import ReaderSettings from './ReaderSettings';
import Quiz from './Quiz';
import useHotkeys from '../lib/useHotkeys';
import {
    DEFAULT_PUSH_INTENSITY, PUSH_PHASES, achievedMultiplier, intensityLabel, phaseWpm
} from '../lib/protocol';
import { normalizeQuestions } from '../lib/quiz';

const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Runs the speed-push protocol: three escalating passes over section A, then a
 * single measured read of the unseen section B followed by a quiz.
 *
 * Only the final phase is timed and recorded. The earlier passes are training
 * load, not measurement.
 */
export default function SpeedPush({
    passage, targetWpm, intensity = DEFAULT_PUSH_INTENSITY, settings, reading, patchReading, updateSettings, onFinish, onExit
}) {
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [countdown, setCountdown] = useState(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [phaseIdx, setPhaseIdx] = useState(0);
    const [isBriefing, setIsBriefing] = useState(true);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPhaseDone, setIsPhaseDone] = useState(false);
    const [quizActive, setQuizActive] = useState(false);
    const [measured, setMeasured] = useState(null);

    const phase = PUSH_PHASES[phaseIdx];
    const isLastPhase = phaseIdx === PUSH_PHASES.length - 1;
    const text = phase.section === 'a' ? passage.sectionA : passage.sectionB;
    const wpm = phaseWpm(targetWpm, phase, intensity);
    // The ratio actually being run, not the one requested: at a high target the
    // drill ceiling holds the blast below its nominal multiplier.
    const multiplier = achievedMultiplier(targetWpm, phase, intensity);

    const questions = useMemo(() => normalizeQuestions(passage.questions), [passage]);

    // Only the measured phase runs a clock.
    const startedAtRef = useRef(null);
    const accumulatedRef = useRef(0);

    const stopClock = useCallback(() => {
        if (startedAtRef.current !== null) {
            accumulatedRef.current += Date.now() - startedAtRef.current;
            startedAtRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!phase.measured) return;
        if (isPlaying && !isBriefing) {
            if (startedAtRef.current === null) startedAtRef.current = Date.now();
        } else {
            stopClock();
        }
    }, [isPlaying, isBriefing, phase.measured, stopClock]);

    // A hidden tab starves the pacer of animation frames while the clock keeps
    // running, so pause rather than record a deflated speed.
    useEffect(() => {
        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') { setIsPlaying(false); setCountdown(null); }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, []);

    // --- Countdown, settings and full screen (shared behaviour with the reader) ---
    useEffect(() => {
        if (countdown === null) return undefined;
        const t = setTimeout(() => {
            if (countdown <= 1) { setCountdown(null); setIsPlaying(true); }
            else setCountdown(countdown - 1);
        }, 600);
        return () => clearTimeout(t);
    }, [countdown]);

    const play = () => { if (reading.countdown) setCountdown(3); else setIsPlaying(true); };
    const pause = () => { setIsPlaying(false); setCountdown(null); };
    const togglePlay = () => {
        if (countdown !== null) { setCountdown(null); return; }
        if (isPlaying) pause(); else play();
    };

    const openSettings = () => { pause(); setSettingsOpen(true); };
    const closeSettings = useCallback(() => setSettingsOpen(false), []);

    useEffect(() => {
        const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);
    useEffect(() => () => { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); }, []);
    const toggleFullscreen = () => {
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        else document.documentElement.requestFullscreen?.().catch(() => {});
    };

    const doneRef = useRef(false);
    useEffect(() => { doneRef.current = false; }, [phaseIdx]);

    const handlePhaseComplete = useCallback(() => {
        if (doneRef.current) return;
        doneRef.current = true;
        setIsPlaying(false);
        setIsPhaseDone(true);
    }, []);

    const advance = () => {
        if (!isLastPhase) {
            setPhaseIdx(phaseIdx + 1);
            setIsPhaseDone(false);
            setIsBriefing(true);
            return;
        }

        stopClock();
        const words = wordCount(passage.sectionB);
        const elapsedMs = accumulatedRef.current;
        // Fall back to the paced rate if the clock never really ran.
        const actual = elapsedMs > 500
            ? Math.min(3000, Math.max(50, Math.round(words / (elapsedMs / 60000))))
            : wpm;

        setMeasured({ wpm: actual, words, elapsedMs, drill: 'push' });
        if (questions.length > 0) setQuizActive(true);
        else onFinish({ wpm: actual, score: null, words, elapsedMs, drill: 'push' });
    };

    const begin = () => { setIsBriefing(false); play(); };

    useHotkeys({
        ' ': () => {
            if (isBriefing) begin();
            else if (isPhaseDone) advance();
            else togglePlay();
        },
        s: () => openSettings(),
        f: () => toggleFullscreen(),
        Escape: () => onExit?.()
    }, !quizActive && !settingsOpen);

    const zenHidden = reading.zen && isPlaying;

    if (quizActive && measured) {
        return (
            <Quiz
                questions={questions}
                ctaLabel="Log Session"
                resultSubtitle={() => `read at ${measured.wpm} WPM`}
                resultNote={(score) => score >= 90
                    ? 'Comfortable at the stretch pace — your target moves up.'
                    : score >= 70
                        ? 'In the training band. Target speed holds here.'
                        : 'Retention slipped at this pace. Target speed eases back.'}
                onDone={(score) => onFinish({ ...measured, score })}
            />
        );
    }

    return (
        <div className="h-full flex flex-col animate-in fade-in pb-12">
            <header className={`bg-slate-900 border border-slate-800 p-4 rounded-2xl mb-6 transition-opacity duration-300 ${zenHidden ? 'opacity-0 hover:opacity-100 focus-within:opacity-100' : ''}`}>
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <button onClick={onExit} className="text-slate-400 hover:text-white font-medium text-sm">← Exit drill</button>
                    <div className="flex items-center gap-2 ml-auto">
                        <span className="text-sm font-mono font-bold text-purple-400">{wpm} WPM</span>
                        <span className="text-xs text-slate-500">({multiplier}× target)</span>
                        {phase.overload && (
                            <span className="text-xs text-slate-600 border-l border-slate-800 pl-2 hidden sm:inline">
                                {intensityLabel(intensity)} overload
                            </span>
                        )}
                        <button onClick={toggleFullscreen} aria-label={isFullscreen ? 'Leave full screen' : 'Full screen'} title="Full screen (F)" className="ml-1 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
                            {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                        </button>
                        <button onClick={openSettings} aria-label="Reading settings" title="Reading settings (S)" className="p-2 rounded-xl border border-slate-800 text-slate-300 hover:text-white hover:border-slate-600 transition-colors">
                            <Settings2 size={17} />
                        </button>
                    </div>
                </div>

                <div className="flex gap-2 mt-4">
                    {PUSH_PHASES.map((p, i) => (
                        <div key={p.key} className="flex-1">
                            <div className={`h-1.5 rounded-full transition-colors ${i < phaseIdx ? 'bg-purple-500' : i === phaseIdx ? 'bg-purple-400' : 'bg-slate-800'}`} />
                            <div className={`text-[11px] mt-1.5 font-bold uppercase tracking-wide ${i === phaseIdx ? 'text-purple-400' : 'text-slate-600'}`}>
                                {p.label}
                            </div>
                        </div>
                    ))}
                </div>
            </header>

            {isBriefing ? (
                <div className="flex-1 flex items-center justify-center">
                    <div className="max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-8 md:p-10 text-center">
                        <div className="inline-flex p-3 bg-purple-500/20 rounded-2xl text-purple-400 mb-6"><Zap size={28} /></div>
                        <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                            Phase {phaseIdx + 1} of {PUSH_PHASES.length}
                        </div>
                        <h2 className="text-3xl font-bold text-white mb-3">{phase.label}</h2>
                        <p className="text-purple-400 font-medium mb-4">{phase.blurb}</p>
                        <p className="text-slate-400 leading-relaxed mb-4">{phase.instruction}</p>
                        <p className="text-xs text-slate-500 leading-relaxed mb-8">
                            {phase.overload
                                ? `Running at ${multiplier}× your target — ${intensityLabel(intensity)} overload, set by how you scored on recent measured reads.`
                                : phase.measured
                                    ? 'This pace is fixed at 1.3× your target, so the result stays comparable session to session.'
                                    : 'Your reference pace, straight from your target speed.'}
                        </p>
                        <div className="flex items-center justify-center gap-6 text-sm text-slate-500 mb-8 font-mono">
                            <span>{wpm} WPM</span>
                            <span>{wordCount(text)} words</span>
                            <span>~{Math.round((wordCount(text) / wpm) * 60)}s</span>
                        </div>
                        <button
                            onClick={begin}
                            className="w-full bg-purple-600 hover:bg-purple-500 text-white py-4 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
                        >
                            <Play size={18} className="fill-current" /> Begin {phase.label}
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <ReadingSurface reading={reading} className="relative flex-1 border border-slate-800/40 rounded-3xl p-6 md:p-12 overflow-y-auto">
                        {countdown !== null && (
                            <div className="absolute inset-0 z-10 grid place-items-center pointer-events-none" aria-live="assertive">
                                <span key={countdown} className="text-7xl font-black animate-in zoom-in-50 fade-in duration-300" style={{ color: 'var(--reading-fg)' }}>{countdown}</span>
                            </div>
                        )}
                        <PacedText
                            key={phase.key}
                            text={text}
                            wpm={wpm}
                            isRunning={isPlaying}
                            bionicReading={settings.bionicReading}
                            bionicStrength={reading.bionicStrength}
                            pacerStyle={reading.pacerStyle}
                            dimRead={reading.dimRead}
                            onComplete={handlePhaseComplete}
                        />
                    </ReadingSurface>

                    <div className="py-6 flex justify-center">
                        {isPhaseDone ? (
                            <button
                                onClick={advance}
                                className="bg-purple-600 hover:bg-purple-500 text-white px-8 py-4 rounded-2xl font-bold transition-colors flex items-center gap-2"
                            >
                                {isLastPhase ? 'Finish and answer questions' : `Next: ${PUSH_PHASES[phaseIdx + 1].label}`}
                                <ChevronRight size={18} />
                            </button>
                        ) : (
                            <button
                                onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}
                                className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 ${isPlaying ? 'bg-slate-800 text-slate-300' : 'bg-purple-600 text-white'}`}
                            >
                                {isPlaying ? <Pause size={26} /> : <Play size={26} className="ml-1" />}
                            </button>
                        )}
                    </div>
                </>
            )}
            <ReaderSettings
                open={settingsOpen} onClose={closeSettings} mode="paced"
                reading={reading} patchReading={patchReading}
                settings={settings} updateSettings={updateSettings}
            />
        </div>
    );
}
