import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Grid3x3, Layers, Maximize, Target, TrendingUp } from 'lucide-react';
import SchulteDrill from '../components/drills/SchulteDrill';
import ChunkFlashDrill from '../components/drills/ChunkFlashDrill';
import {
    PERIPHERAL_ROUNDS, PERIPHERAL_START_MS, bestMetric, createDrillResult,
    drillTrend, drillsOfKind, latestMetric, nextFlashMs, peripheralThreshold,
    startingChunkSize, startingFlashMs
} from '../lib/drillStats';

function Tools({ drills, adaptiveStart = true, onDrillComplete, addNotification }) {
    const [activeDrill, setActiveDrill] = useState(null);

    const finish = (kind, metric, detail) => {
        onDrillComplete(createDrillResult({ kind, metric, detail }));
        setActiveDrill(null);
    };

    if (activeDrill === 'peripheral') {
        return (
            <PeripheralDrill
                previousBest={bestMetric(drills, 'peripheral')}
                startAt={adaptiveStart ? startingFlashMs(drills) : PERIPHERAL_START_MS}
                onExit={() => setActiveDrill(null)}
                onFinish={(metric, detail) => finish('peripheral', metric, detail)}
            />
        );
    }
    if (activeDrill === 'scanning') {
        return (
            <ScanningDrill
                onExit={() => setActiveDrill(null)}
                onFinish={(metric) => finish('scanning', metric)}
                addNotification={addNotification}
            />
        );
    }
    if (activeDrill === 'chunk') {
        return (
            <ChunkFlashDrill
                previousBest={bestMetric(drills, 'chunk')}
                startAt={adaptiveStart ? startingChunkSize(drills) : undefined}
                onExit={() => setActiveDrill(null)}
                onFinish={(metric, detail) => finish('chunk', metric, detail)}
            />
        );
    }
    if (activeDrill === 'schulte') {
        return (
            <SchulteDrill
                previousBest={bestMetric(drills, 'schulte')}
                onExit={() => setActiveDrill(null)}
                onFinish={(metric, detail) => finish('schulte', metric, detail)}
            />
        );
    }

    return (
        <div className="max-w-4xl mx-auto animate-in slide-in-from-bottom-4 space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-white">Neuro-Drills</h1>
                <p className="text-slate-400 mt-2">
                    Targeted mini-games for the two limits that cap reading speed once pacing alone stops helping.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <DrillCard
                    title="Chunk Perception" icon={<Layers size={32} />} color="text-blue-400" bg="bg-blue-500/10"
                    desc="How many words you can take in from a single glance. Words per fixation multiply straight into words per minute, which makes this the most direct lever on your reading speed."
                    unit=" words"
                    best={bestMetric(drills, 'chunk')} latest={latestMetric(drills, 'chunk')}
                    trend={drillTrend(drills, 'chunk')} runs={drillsOfKind(drills, 'chunk').length}
                    onClick={() => setActiveDrill('chunk')}
                />
                <DrillCard
                    title="Schulte Table" icon={<Grid3x3 size={32} />} color="text-cyan-400" bg="bg-cyan-500/10"
                    desc="Find 1 to 25 in order while holding your gaze on the centre. Widens the area you can attend to without moving your eyes."
                    unit="s"
                    best={bestMetric(drills, 'schulte')} latest={latestMetric(drills, 'schulte')}
                    trend={drillTrend(drills, 'schulte')} runs={drillsOfKind(drills, 'schulte').length}
                    onClick={() => setActiveDrill('schulte')}
                />
                <DrillCard
                    title="Peripheral Expansion" icon={<Maximize size={32} />} color="text-emerald-400" bg="bg-emerald-500/10"
                    desc="How briefly a pair of letters can flash at the edges of your vision and still register. This is perceptual span — the wall that stops you reading every word much past 600 WPM."
                    unit="ms"
                    best={bestMetric(drills, 'peripheral')} latest={latestMetric(drills, 'peripheral')}
                    trend={drillTrend(drills, 'peripheral')} runs={drillsOfKind(drills, 'peripheral').length}
                    onClick={() => setActiveDrill('peripheral')}
                />
                <DrillCard
                    title="Target Scanning" icon={<Target size={32} />} color="text-amber-400" bg="bg-amber-500/10"
                    desc="How fast you can locate a word in a block of text without reading it. Trains the visual search you need to skim rather than read."
                    unit="s"
                    best={bestMetric(drills, 'scanning')} latest={latestMetric(drills, 'scanning')}
                    trend={drillTrend(drills, 'scanning')} runs={drillsOfKind(drills, 'scanning').length}
                    onClick={() => setActiveDrill('scanning')}
                />
            </div>

            <p className="text-xs text-slate-500 text-center">
                Each drill needs six runs before a trend means anything. Chunk Perception scores higher-is-better; the rest are timed, so lower wins.
            </p>
        </div>
    );
}

function DrillCard({ title, desc, icon, color, bg, unit, best, latest, trend, runs, onClick }) {
    return (
        <button type="button" onClick={onClick} className="bg-slate-900 border border-slate-800 p-8 rounded-3xl hover:border-purple-500/50 focus:outline-none focus:border-purple-500 transition-colors group cursor-pointer text-left w-full flex flex-col">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 ${bg} ${color}`}>{icon}</div>
            <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
            <p className="text-slate-400 text-sm leading-relaxed mb-6 flex-1">{desc}</p>

            {runs > 0 ? (
                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 mb-6">
                    <div className="flex items-end justify-between">
                        <div>
                            <div className={`text-2xl font-black ${color}`}>{best}<span className="text-sm ml-0.5">{unit}</span></div>
                            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mt-0.5">Best</div>
                        </div>
                        <div className="text-right">
                            <div className="text-sm font-mono text-slate-300">{latest}{unit}</div>
                            <div className="text-[11px] text-slate-500">last of {runs}</div>
                        </div>
                    </div>
                    {trend !== null && (
                        <div className={`text-xs mt-3 flex items-center gap-1 font-medium ${trend < 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                            <TrendingUp size={12} className={trend < 0 ? 'rotate-180' : ''} />
                            {trend < 0 ? `${Math.abs(trend)}% better than when you started` : `${trend}% off your early runs`}
                        </div>
                    )}
                </div>
            ) : (
                <div className="text-xs text-slate-600 mb-6">No runs yet — your score is recorded and tracked.</div>
            )}

            <span className="text-purple-400 font-bold text-sm flex items-center gap-1 group-hover:gap-2 transition-all">
                {runs > 0 ? 'Run again' : 'Launch drill'} <ChevronRight size={16}/>
            </span>
        </button>
    );
}

/**
 * A tachistoscope-style staircase. Two letters flash at the extreme edges of
 * the screen for a duration that shortens each time you read them and
 * lengthens when you miss, converging on your threshold rather than just
 * counting hits out of five.
 */
function PeripheralDrill({ previousBest, startAt = PERIPHERAL_START_MS, onExit, onFinish }) {
    const [gameState, setGameState] = useState('idle');
    const [targets, setTargets] = useState(['A', 'B']);
    const [input, setInput] = useState('');
    const [round, setRound] = useState(0);
    const [flashMs, setFlashMs] = useState(startAt);
    const [rounds, setRounds] = useState([]);

    const timersRef = useRef([]);
    useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

    // Background tabs clamp setTimeout to about a second, so a 150ms flash
    // would silently last far longer than the number being recorded. The
    // measurement is the whole point here, so abandon the run rather than
    // storing a threshold that was never really shown.
    useEffect(() => {
        const onHidden = () => {
            if (document.visibilityState !== 'hidden') return;
            timersRef.current.forEach(clearTimeout);
            timersRef.current = [];
            setGameState(current => (current === 'idle' || current === 'done' ? current : 'aborted'));
        };
        document.addEventListener('visibilitychange', onHidden);
        return () => document.removeEventListener('visibilitychange', onHidden);
    }, []);

    const playRound = (durationMs) => {
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];

        setGameState('focus');
        setInput('');
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        setTargets([
            chars[Math.floor(Math.random() * chars.length)],
            chars[Math.floor(Math.random() * chars.length)]
        ]);

        timersRef.current.push(setTimeout(() => {
            setGameState('flash');
            timersRef.current.push(setTimeout(() => setGameState('input'), durationMs));
        }, 1200));
    };

    const start = () => {
        setRounds([]);
        setRound(1);
        setFlashMs(startAt);
        playRound(startAt);
    };

    const submit = (e) => {
        e.preventDefault();
        const correct = input.toUpperCase() === targets.join('');
        const recorded = [...rounds, { flashMs, correct }];
        setRounds(recorded);

        if (round < PERIPHERAL_ROUNDS) {
            const next = nextFlashMs(flashMs, correct);
            setFlashMs(next);
            setRound(round + 1);
            playRound(next);
        } else {
            setGameState('done');
        }
    };

    const threshold = peripheralThreshold(rounds);
    const hits = rounds.filter(r => r.correct).length;

    return (
        <div className="h-full min-h-[500px] flex flex-col items-center justify-center bg-slate-900 border border-slate-800 rounded-3xl relative p-8">
            <button onClick={onExit} className="absolute top-6 left-6 text-slate-400 hover:text-white font-medium">← Back</button>

            {gameState !== 'idle' && gameState !== 'done' && gameState !== 'aborted' && (
                <div className="absolute top-6 right-6 text-xs font-mono text-slate-500">
                    Round {round}/{PERIPHERAL_ROUNDS} · {flashMs}ms
                </div>
            )}

            {gameState === 'idle' && (
                <div className="text-center">
                    <Maximize className="w-16 h-16 text-emerald-400 mx-auto mb-6" />
                    <h2 className="text-3xl font-bold text-white mb-4">Peripheral Expansion</h2>
                    <p className="text-slate-400 max-w-md mx-auto mb-4">
                        Stare at the centre cross without moving your eyes. Two letters flash at the extreme edges, then you type what you saw.
                    </p>
                    <p className="text-slate-500 text-sm max-w-md mx-auto mb-3">
                        The flash gets shorter every time you are right and longer when you are wrong, over {PERIPHERAL_ROUNDS} rounds.
                        Your score is the briefest flash you read correctly.
                        {previousBest !== null && <> Your best so far is <strong className="text-emerald-400">{previousBest}ms</strong>.</>}
                    </p>
                    <p className="text-slate-500 text-sm max-w-md mx-auto mb-8">
                        {startAt === PERIPHERAL_START_MS
                            ? `Starting at ${startAt}ms.`
                            : `Starting at ${startAt}ms, just inside your recent threshold — no point spending half the rounds walking back down to it.`}
                    </p>
                    <button onClick={start} className="bg-emerald-600 hover:bg-emerald-500 transition-colors text-white px-8 py-3 rounded-xl font-bold">Start Drill</button>
                </div>
            )}

            {gameState === 'aborted' && (
                <div className="text-center max-w-sm">
                    <h2 className="text-2xl font-bold text-white mb-3">Run abandoned</h2>
                    <p className="text-slate-400 mb-8">
                        The tab lost focus mid-drill. Browsers slow timers in background tabs, so the flash was longer than it claimed and the
                        result would not have meant anything.
                    </p>
                    <button onClick={start} className="bg-emerald-600 hover:bg-emerald-500 transition-colors text-white px-8 py-3 rounded-xl font-bold">Start Again</button>
                </div>
            )}

            {gameState === 'focus' && <div className="text-6xl text-slate-500 font-bold animate-pulse">+</div>}

            {gameState === 'flash' && (
                <div className="w-full flex justify-between px-8 md:px-32 absolute top-1/2 -translate-y-1/2">
                    <div className="text-5xl md:text-6xl font-black text-white">{targets[0]}</div>
                    <div className="text-5xl md:text-6xl font-black text-white">{targets[1]}</div>
                </div>
            )}

            {gameState === 'input' && (
                <form onSubmit={submit} className="text-center">
                    <h3 className="text-white font-bold mb-4">What were the two letters?</h3>
                    {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the drill expects typing the instant the flash ends; hunting for the field would corrupt the timing */}
                    <input autoFocus type="text" maxLength={2} value={input} onChange={e => setInput(e.target.value.toUpperCase())} aria-label="The two letters you saw" className="bg-slate-950 border border-slate-700 text-white text-center text-3xl font-bold px-4 py-3 rounded-xl outline-none focus:border-emerald-500 uppercase w-32 tracking-widest mb-4 block mx-auto transition-colors" />
                    <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 transition-colors text-white px-6 py-2 rounded-lg font-bold">Submit</button>
                </form>
            )}

            {gameState === 'done' && (
                <div className="text-center">
                    <h2 className="text-3xl font-bold text-white mb-2">Drill Complete</h2>
                    {threshold === null ? (
                        <p className="text-slate-400 mb-6 max-w-sm">
                            Nothing read correctly this time. The flash starts longer next run — this is a hard drill, and the score only counts a clean read.
                        </p>
                    ) : (
                        <>
                            <div className="text-5xl font-black text-emerald-400 my-4">{threshold}<span className="text-xl ml-1">ms</span></div>
                            <p className="text-slate-400 mb-2">Briefest flash you read correctly, {hits} of {rounds.length} rounds right.</p>
                            {previousBest !== null && (
                                <p className="text-sm mb-6 font-medium">
                                    {threshold < previousBest
                                        ? <span className="text-emerald-400">New best — {previousBest - threshold}ms better than before.</span>
                                        : <span className="text-slate-500">Best remains {previousBest}ms.</span>}
                                </p>
                            )}
                        </>
                    )}
                    <button
                        onClick={() => onFinish(threshold, { hits, rounds: rounds.length })}
                        disabled={threshold === null}
                        className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 transition-colors text-white px-6 py-3 rounded-xl font-bold"
                    >
                        Save Result
                    </button>
                    {threshold === null && (
                        <button onClick={onExit} className="block mx-auto mt-3 text-slate-400 hover:text-white text-sm font-medium">Back without saving</button>
                    )}
                </div>
            )}
        </div>
    );
}

function ScanningDrill({ onExit, onFinish, addNotification }) {
    const [targetWord, setTargetWord] = useState('');
    const [misses, setMisses] = useState(0);
    const startedAtRef = useRef(null);
    const textData = "Neuroplasticity refers to the brains ability to change and adapt as a result of experience. It is a fundamental concept in modern neuroscience, challenging the historically held belief that the adult brain is entirely rigid. By engaging in intense, novel learning tasks, such as speed reading or complex problem solving, individuals can stimulate the formation of new neural connections. This process of neuroplasticity is essential for recovery from injuries and for optimizing cognitive performance across the lifespan.";

    const initDrill = () => {
        const longWords = textData.split(/\s+/).filter(w => w.replace(/[^a-zA-Z]/g, '').length > 8);
        const randomTarget = longWords[Math.floor(Math.random() * longWords.length)].replace(/[^a-zA-Z]/g, '');
        setTargetWord(randomTarget.toLowerCase());
        setMisses(0);
        startedAtRef.current = Date.now();
    };

    const handleWordClick = (word) => {
        const clean = word.replace(/[^a-zA-Z]/g, '').toLowerCase();
        if (clean !== targetWord) {
            setMisses(m => m + 1);
            addNotification("Not that one. Keep scanning.");
            return;
        }
        // Wrong clicks are penalised rather than free, otherwise clicking
        // everything at random would beat scanning carefully.
        const seconds = (Date.now() - startedAtRef.current) / 1000 + misses;
        onFinish(Math.round(seconds * 10) / 10);
    };

    return (
        <div className="h-full flex flex-col bg-slate-900 border border-slate-800 rounded-3xl relative p-6 md:p-8 overflow-y-auto">
            <button onClick={onExit} className="absolute top-6 left-6 text-slate-400 hover:text-white font-medium z-10">← Back</button>

            {!targetWord ? (
                <div className="text-center m-auto pt-12">
                    <Target className="w-16 h-16 text-amber-400 mx-auto mb-6" />
                    <h2 className="text-3xl font-bold text-white mb-4">Target Scanning</h2>
                    <p className="text-slate-400 max-w-md mx-auto mb-8">
                        Locate the target word as fast as you can. Do not read the text — sweep it visually for the shape of the word.
                        Wrong clicks add a one-second penalty.
                    </p>
                    <button onClick={initDrill} className="bg-amber-600 hover:bg-amber-500 transition-colors text-white px-8 py-3 rounded-xl font-bold">Start Scanning</button>
                </div>
            ) : (
                <div className="mt-12 max-w-3xl mx-auto pb-12">
                    <div className="bg-slate-950 border border-slate-800 p-6 rounded-2xl mb-8 text-center sticky top-0 z-10 shadow-md">
                        <span className="text-slate-400 text-sm font-bold uppercase tracking-wider block mb-2">Find This Word</span>
                        <span className="text-3xl md:text-4xl font-black text-amber-400 break-words">{targetWord}</span>
                        {misses > 0 && <div className="text-xs text-red-400 mt-2">{misses}s penalty</div>}
                    </div>
                    <div className="text-lg md:text-xl leading-loose text-slate-300 select-none">
                        {textData.split(/\s+/).map((word, i) => (
                            <button
                                type="button"
                                key={i}
                                onClick={() => handleWordClick(word)}
                                // inline-block swallows a trailing space, so the gap has to be a margin
                                className="cursor-pointer hover:bg-slate-800 hover:text-white rounded px-1 mr-[0.28em] transition-colors inline-block"
                            >
                                {word}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default Tools;
