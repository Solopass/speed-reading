import { useEffect, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import {
    CHUNK_FLASH_MS, CHUNK_ROUNDS, CHUNK_START_WORDS, chunkThreshold, nextChunkSize
} from '../../lib/drillStats';

// Ordinary, high-frequency words: the drill is testing how much you can take in
// at once, not whether you know the vocabulary.
const WORD_BANK = [
    'water', 'winter', 'market', 'letter', 'summer', 'garden', 'window', 'silver', 'forest', 'engine',
    'paper', 'bridge', 'candle', 'harbour', 'meadow', 'lantern', 'thunder', 'cotton', 'copper', 'valley',
    'morning', 'shadow', 'pocket', 'ribbon', 'anchor', 'pillar', 'saddle', 'timber', 'furnace', 'orchard',
    'signal', 'pattern', 'mirror', 'tunnel', 'compass', 'blanket', 'cabinet', 'kettle', 'marble', 'quarry'
];

const pick = (n) => {
    const pool = [...WORD_BANK];
    const chosen = [];
    for (let i = 0; i < n && pool.length; i++) {
        chosen.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
    }
    return chosen;
};

const shuffle = (items) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
};

/**
 * Builds three near-miss alternatives by swapping one word of the real chunk.
 * Recognition rather than typing, so the drill measures perception instead of
 * recall or spelling — and the distractors are close enough that guessing from
 * a half-glimpse does not work.
 */
const buildOptions = (chunk) => {
    const spare = WORD_BANK.filter(w => !chunk.includes(w));
    const decoys = [];
    for (let i = 0; i < 3; i++) {
        const copy = [...chunk];
        copy[Math.floor(Math.random() * copy.length)] = spare[Math.floor(Math.random() * spare.length)];
        const text = copy.join(' ');
        if (!decoys.includes(text) && text !== chunk.join(' ')) decoys.push(text);
    }
    return shuffle([chunk.join(' '), ...decoys]);
};

/**
 * Flashes a phrase too briefly to read word by word, then asks which one it
 * was. The chunk widens after every correct answer and narrows after a miss.
 *
 * Words-per-fixation multiplies straight into words-per-minute, so this is the
 * most direct lever on reading speed of any drill here.
 */
export default function ChunkFlashDrill({ previousBest, startAt = CHUNK_START_WORDS, onExit, onFinish }) {
    const [state, setState] = useState('idle');   // idle | focus | flash | choose | done | aborted
    const [size, setSize] = useState(startAt);
    const [round, setRound] = useState(0);
    const [chunk, setChunk] = useState([]);
    const [options, setOptions] = useState([]);
    const [rounds, setRounds] = useState([]);

    const timersRef = useRef([]);
    useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

    // A background tab stretches the flash far beyond its stated duration.
    useEffect(() => {
        const onHidden = () => {
            if (document.visibilityState !== 'hidden') return;
            timersRef.current.forEach(clearTimeout);
            timersRef.current = [];
            setState(current => (current === 'idle' || current === 'done' ? current : 'aborted'));
        };
        document.addEventListener('visibilitychange', onHidden);
        return () => document.removeEventListener('visibilitychange', onHidden);
    }, []);

    const playRound = (words) => {
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];

        const next = pick(words);
        setChunk(next);
        setOptions(buildOptions(next));
        setState('focus');

        timersRef.current.push(setTimeout(() => {
            setState('flash');
            timersRef.current.push(setTimeout(() => setState('choose'), CHUNK_FLASH_MS));
        }, 900));
    };

    const start = () => {
        setRounds([]);
        setRound(1);
        setSize(startAt);
        playRound(startAt);
    };

    const answer = (choice) => {
        const correct = choice === chunk.join(' ');
        const recorded = [...rounds, { size, correct }];
        setRounds(recorded);

        if (round < CHUNK_ROUNDS) {
            const nextSize = nextChunkSize(size, correct);
            setSize(nextSize);
            setRound(round + 1);
            playRound(nextSize);
        } else {
            setState('done');
        }
    };

    const threshold = chunkThreshold(rounds);

    return (
        <div className="h-full min-h-[520px] flex flex-col items-center justify-center bg-slate-900 border border-slate-800 rounded-3xl relative p-8">
            <button onClick={onExit} className="absolute top-6 left-6 text-slate-400 hover:text-white font-medium">← Back</button>

            {['focus', 'flash', 'choose'].includes(state) && (
                <div className="absolute top-6 right-6 text-xs font-mono text-slate-500">
                    Round {round}/{CHUNK_ROUNDS} · {size} word{size === 1 ? '' : 's'}
                </div>
            )}

            {state === 'idle' && (
                <div className="text-center max-w-md">
                    <Layers className="w-16 h-16 text-blue-400 mx-auto mb-6" />
                    <h2 className="text-3xl font-bold text-white mb-4">Chunk Perception</h2>
                    <p className="text-slate-400 mb-4">
                        A phrase flashes for {CHUNK_FLASH_MS}ms — too fast to read word by word. Then pick which phrase it was.
                    </p>
                    <p className="text-slate-500 text-sm mb-3">
                        Keep your eyes still and take the whole phrase in at once. It widens by a word each time you are right.
                        Words per fixation multiply straight into words per minute, so this is the most direct lever on your speed there is.
                        {previousBest !== null && <> Your best is <strong className="text-blue-400">{previousBest} words</strong>.</>}
                    </p>
                    <p className="text-slate-500 text-sm mb-8">
                        Starting at {startAt} word{startAt === 1 ? '' : 's'}
                        {startAt === CHUNK_START_WORDS ? '.' : ', just under the width you have been managing.'}
                    </p>
                    <button onClick={start} className="bg-blue-600 hover:bg-blue-500 transition-colors text-white px-8 py-3 rounded-xl font-bold">Start Drill</button>
                </div>
            )}

            {state === 'aborted' && (
                <div className="text-center max-w-sm">
                    <h2 className="text-2xl font-bold text-white mb-3">Run abandoned</h2>
                    <p className="text-slate-400 mb-8">
                        The tab lost focus mid-drill. Browsers slow timers in background tabs, so the flash lasted longer than it claimed.
                    </p>
                    <button onClick={start} className="bg-blue-600 hover:bg-blue-500 transition-colors text-white px-8 py-3 rounded-xl font-bold">Start Again</button>
                </div>
            )}

            {state === 'focus' && <div className="text-6xl text-slate-500 font-bold animate-pulse">+</div>}

            {state === 'flash' && (
                <div className="text-3xl md:text-4xl font-bold text-white tracking-wide text-center px-4">
                    {chunk.join(' ')}
                </div>
            )}

            {state === 'choose' && (
                <div className="w-full max-w-lg text-center">
                    <h3 className="text-white font-bold mb-5">Which phrase was it?</h3>
                    <div className="grid grid-cols-1 gap-2">
                        {options.map(option => (
                            <button
                                key={option}
                                onClick={() => answer(option)}
                                className="bg-slate-950 border border-slate-800 hover:border-blue-500 hover:bg-blue-950/30 text-slate-200 px-4 py-3 rounded-xl font-medium transition-colors"
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {state === 'done' && (
                <div className="text-center">
                    <h2 className="text-3xl font-bold text-white mb-2">Drill Complete</h2>
                    {threshold === null ? (
                        <p className="text-slate-400 mb-6 max-w-sm">
                            Nothing recognised this time. That happens — the flash is deliberately shorter than a comfortable fixation.
                        </p>
                    ) : (
                        <>
                            <div className="text-5xl font-black text-blue-400 my-4">{threshold}<span className="text-xl ml-2">words</span></div>
                            <p className="text-slate-400 mb-2">
                                Widest phrase you took in from a single {CHUNK_FLASH_MS}ms flash.
                            </p>
                            {previousBest !== null && (
                                <p className="text-sm mb-6 font-medium">
                                    {threshold > previousBest
                                        ? <span className="text-blue-400">New best — {threshold - previousBest} more than before.</span>
                                        : <span className="text-slate-500">Best remains {previousBest} words.</span>}
                                </p>
                            )}
                        </>
                    )}
                    <button
                        onClick={() => onFinish(threshold, { rounds: rounds.length })}
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
