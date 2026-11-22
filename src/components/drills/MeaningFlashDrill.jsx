import { useEffect, useRef, useState } from 'react';
import { Lightbulb } from 'lucide-react';

const ROUNDS = 10;
const START_MS_PER_WORD = 250;   // about 240 WPM
const FLOOR_MS_PER_WORD = 40;
const CEILING_MS_PER_WORD = 700;

const wordCount = (s) => String(s).trim().split(/\s+/).length;

function shuffled(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** The speed you can still understand at: the average of the last rounds, per word. */
function meaningThreshold(rounds) {
    const last = rounds.slice(-5);
    if (!last.length) return null;
    return Math.round(last.reduce((n, r) => n + r.msPerWord, 0) / last.length);
}

/**
 * Meaning at a glance: a phrase, sentence or key term from your document
 * flashes, then you choose what it meant. Right answers shorten the flash,
 * misses lengthen it, so it settles on how briefly you can read for meaning.
 */
export default function MeaningFlashDrill({ pack, previousBest, onExit, onFinish }) {
    const items = pack?.meaning ?? [];
    const [state, setState] = useState('idle');   // idle | focus | flash | choose | feedback | done | aborted
    const [queue, setQueue] = useState([]);
    const [round, setRound] = useState(0);
    const [msPerWord, setMsPerWord] = useState(START_MS_PER_WORD);
    const [rounds, setRounds] = useState([]);
    const [picked, setPicked] = useState(null);
    const timers = useRef([]);
    useEffect(() => () => timers.current.forEach(clearTimeout), []);

    // A hidden tab stretches the flash, so the run is abandoned rather than mis-measured.
    useEffect(() => {
        const onHidden = () => {
            if (document.visibilityState !== 'hidden') return;
            timers.current.forEach(clearTimeout);
            setState(s => (s === 'idle' || s === 'done' ? s : 'aborted'));
        };
        document.addEventListener('visibilitychange', onHidden);
        return () => document.removeEventListener('visibilitychange', onHidden);
    }, []);

    const item = queue[round - 1];

    const play = (r, q, ms) => {
        timers.current.forEach(clearTimeout);
        timers.current = [];
        setPicked(null);
        setState('focus');
        const it = q[r - 1];
        const flashMs = Math.max(60, ms * wordCount(it.prompt));
        timers.current.push(setTimeout(() => {
            setState('flash');
            timers.current.push(setTimeout(() => setState('choose'), flashMs));
        }, 800));
    };

    const start = () => {
        const q = shuffled(items).slice(0, Math.min(ROUNDS, items.length));
        setQueue(q);
        setRounds([]);
        setRound(1);
        setMsPerWord(START_MS_PER_WORD);
        play(1, q, START_MS_PER_WORD);
    };

    const answer = (i) => {
        if (state !== 'choose') return;
        const correct = i === item.answer;
        setPicked(i);
        setState('feedback');
        const recorded = [...rounds, { msPerWord, correct }];
        setRounds(recorded);
        const next = Math.round(Math.min(CEILING_MS_PER_WORD, Math.max(FLOOR_MS_PER_WORD, msPerWord * (correct ? 0.85 : 1.25))));
        timers.current.push(setTimeout(() => {
            if (round >= queue.length) { setState('done'); return; }
            setMsPerWord(next);
            setRound(round + 1);
            play(round + 1, queue, next);
        }, correct ? 600 : 1400));
    };

    useEffect(() => {
        if (state !== 'choose') return undefined;
        const onKey = (e) => {
            const n = Number(e.key);
            if (Number.isInteger(n) && n >= 1 && n <= 4) { e.preventDefault(); answer(n - 1); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    const threshold = meaningThreshold(rounds);
    const right = rounds.filter(r => r.correct).length;

    return (
        <div className="h-full min-h-[520px] flex flex-col items-center justify-center bg-slate-900 border border-slate-800 rounded-3xl relative p-8">
            <button onClick={onExit} className="absolute top-6 left-6 text-slate-400 hover:text-white font-medium">← Back</button>
            {['focus', 'flash', 'choose', 'feedback'].includes(state) && (
                <div className="absolute top-6 right-6 text-xs font-mono text-slate-500">
                    Round {round}/{queue.length} · {msPerWord} ms/word (~{Math.round(60000 / msPerWord)} WPM)
                </div>
            )}

            {state === 'idle' && (
                <div className="text-center max-w-md">
                    <Lightbulb className="w-14 h-14 text-violet-400 mx-auto mb-5" />
                    <h2 className="text-3xl font-bold text-white mb-3">Meaning at a Glance</h2>
                    <p className="text-slate-400 mb-2">
                        A phrase, sentence or key term from <span className="text-slate-200">{pack?.title}</span> flashes. Then pick what it meant.
                    </p>
                    <p className="text-slate-500 text-sm mb-6">Right answers make the flash shorter, misses make it longer. {items.length} items in this pack.</p>
                    {previousBest != null && <p className="text-xs text-slate-500 mb-4">Your best: {previousBest} ms/word</p>}
                    <button onClick={start} disabled={items.length < 3} className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-8 py-3 rounded-xl font-bold">Start</button>
                </div>
            )}

            {state === 'focus' && <div className="text-5xl text-slate-600 font-light select-none">+</div>}

            {state === 'flash' && item && (
                <div className="text-center max-w-2xl text-3xl md:text-4xl font-semibold text-white leading-snug select-none" style={{ fontFamily: 'var(--reading-font)' }}>
                    {item.prompt}
                </div>
            )}

            {(state === 'choose' || state === 'feedback') && item && (
                <div className="w-full max-w-xl space-y-3">
                    <p className="text-center text-sm text-slate-400 mb-2">
                        {item.kind === 'term' ? 'What does that term mean here?' : item.kind === 'sentence' ? 'What did that sentence say?' : 'What did that phrase mean?'}
                    </p>
                    {item.options.map((o, i) => {
                        const tone = state !== 'feedback' ? 'border-slate-700 hover:border-violet-500 text-slate-200'
                            : i === item.answer ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200'
                                : i === picked ? 'border-red-500 bg-red-500/10 text-red-200' : 'border-slate-800 text-slate-500';
                        return (
                            <button key={i} type="button" disabled={state !== 'choose'} onClick={() => answer(i)}
                                className={`w-full flex items-start gap-3 text-left px-4 py-3 rounded-xl border transition-colors ${tone}`}>
                                <span className="font-mono text-xs text-slate-500 mt-0.5">{i + 1}</span>
                                <span>{o}</span>
                            </button>
                        );
                    })}
                    {state === 'feedback' && picked !== item.answer && (
                        <p className="text-center text-xs text-slate-400">It was: <span className="text-slate-200">{item.prompt}</span></p>
                    )}
                </div>
            )}

            {state === 'done' && (
                <div className="text-center">
                    <h2 className="text-3xl font-bold text-white mb-2">{threshold} ms per word</h2>
                    <p className="text-slate-400 mb-6">About {Math.round(60000 / threshold)} WPM for meaning · {right} of {rounds.length} right</p>
                    <button onClick={() => onFinish(threshold, { rounds: rounds.length, right })} className="bg-violet-600 hover:bg-violet-500 text-white px-8 py-3 rounded-xl font-bold">Save result</button>
                </div>
            )}

            {state === 'aborted' && (
                <div className="text-center">
                    <p className="text-slate-300 mb-4">The tab was hidden, so the flash timing was off. That run was not counted.</p>
                    <button onClick={start} className="bg-violet-600 hover:bg-violet-500 text-white px-6 py-2.5 rounded-xl font-bold">Start again</button>
                </div>
            )}
        </div>
    );
}
