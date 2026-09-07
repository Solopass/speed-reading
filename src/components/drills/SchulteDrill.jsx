import { useEffect, useMemo, useRef, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import { SCHULTE_SIZE } from '../../lib/drillStats';

const shuffled = (n) => {
    const values = Array.from({ length: n }, (_, i) => i + 1);
    for (let i = values.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
};

/**
 * A Schulte table: find 1 to 25 in order while holding your gaze on the centre.
 *
 * The point is not the clicking — it is that finding the next number without
 * moving your eyes forces you to widen the area you can attend to at once. That
 * is the same span a reader uses to take in a phrase per fixation, which is why
 * this is a standard fixture of speed-reading training.
 */
export default function SchulteDrill({ previousBest, onExit, onFinish }) {
    const total = SCHULTE_SIZE * SCHULTE_SIZE;
    const [state, setState] = useState('idle');   // idle | running | done | aborted
    const [grid, setGrid] = useState(() => shuffled(total));
    const [next, setNext] = useState(1);
    const [misses, setMisses] = useState(0);
    const [elapsed, setElapsed] = useState(0);

    const startedAtRef = useRef(null);
    // The click handler must not judge a click against a `next` captured in an
    // earlier render, or two fast clicks both count as misses.
    const nextRef = useRef(1);

    // A visible clock, because watching it is half the motivation.
    useEffect(() => {
        if (state !== 'running') return;
        const id = setInterval(() => setElapsed((Date.now() - startedAtRef.current) / 1000), 100);
        return () => clearInterval(id);
    }, [state]);

    // Timers keep running in a hidden tab while the drill does not, so the
    // result would be meaningless. Abandon rather than record it.
    useEffect(() => {
        const onHidden = () => {
            if (document.visibilityState === 'hidden') {
                // Named rather than dropped back to 'idle': silently returning
                // to the start screen looks like the app lost the run for no
                // reason. The other two drills say why, and so should this one.
                setState(current => (current === 'running' ? 'aborted' : current));
            }
        };
        document.addEventListener('visibilitychange', onHidden);
        return () => document.removeEventListener('visibilitychange', onHidden);
    }, []);

    const start = () => {
        setGrid(shuffled(total));
        nextRef.current = 1;
        setNext(1);
        setMisses(0);
        setElapsed(0);
        startedAtRef.current = Date.now();
        setState('running');
    };

    const handleClick = (value) => {
        if (state !== 'running') return;
        if (value !== nextRef.current) {
            setMisses(m => m + 1);
            return;
        }
        if (nextRef.current === total) {
            setElapsed((Date.now() - startedAtRef.current) / 1000);
            setState('done');
            return;
        }
        nextRef.current += 1;
        setNext(nextRef.current);
    };

    // Wrong clicks cost a second each, so hunting at random cannot beat looking.
    const score = useMemo(() => Math.round((elapsed + misses) * 10) / 10, [elapsed, misses]);

    return (
        <div className="h-full min-h-[520px] flex flex-col items-center justify-center bg-slate-900 border border-slate-800 rounded-3xl relative p-8">
            <button onClick={onExit} className="absolute top-6 left-6 text-slate-400 hover:text-white font-medium">← Back</button>

            {state === 'running' && (
                <div className="absolute top-6 right-6 text-right">
                    <div className="font-mono text-2xl font-bold text-white">{elapsed.toFixed(1)}s</div>
                    <div className="text-xs text-slate-500">next: <span className="text-cyan-400 font-bold">{next}</span>{misses > 0 && ` · ${misses}s penalty`}</div>
                </div>
            )}

            {state === 'aborted' && (
                <div className="text-center max-w-sm">
                    <h2 className="text-2xl font-bold text-white mb-3">Run abandoned</h2>
                    <p className="text-slate-400 mb-8">
                        The tab lost focus mid-table. The clock kept running while the drill did not, so the time would not have meant
                        anything.
                    </p>
                    <button onClick={start} className="bg-cyan-600 hover:bg-cyan-500 transition-colors text-white px-8 py-3 rounded-xl font-bold">Start Again</button>
                </div>
            )}

            {state === 'idle' && (
                <div className="text-center max-w-md">
                    <Grid3x3 className="w-16 h-16 text-cyan-400 mx-auto mb-6" />
                    <h2 className="text-3xl font-bold text-white mb-4">Schulte Table</h2>
                    <p className="text-slate-400 mb-4">
                        Find the numbers 1 to {total} in order, as fast as you can — while keeping your eyes fixed on the centre square.
                    </p>
                    <p className="text-slate-500 text-sm mb-8">
                        Resist the urge to hunt around with your gaze. Letting the numbers come to you is the entire exercise: it widens the
                        area you can take in from one fixation, which is the same span that lets you read a phrase at a time instead of a word.
                        Wrong clicks add a second.
                        {previousBest !== null && <> Your best is <strong className="text-cyan-400">{previousBest}s</strong>.</>}
                    </p>
                    <button onClick={start} className="bg-cyan-600 hover:bg-cyan-500 transition-colors text-white px-8 py-3 rounded-xl font-bold">Start Drill</button>
                </div>
            )}

            {state === 'running' && (
                <div
                    className="grid gap-2 select-none"
                    style={{ gridTemplateColumns: `repeat(${SCHULTE_SIZE}, minmax(0, 1fr))` }}
                >
                    {grid.map((value, i) => {
                        const isCentre = i === Math.floor(total / 2);
                        return (
                            <button
                                key={i}
                                onClick={() => handleClick(value)}
                                className={`w-14 h-14 md:w-16 md:h-16 rounded-lg font-bold text-xl md:text-2xl transition-colors ${
                                    value < next
                                        ? 'bg-cyan-950/40 text-slate-600'
                                        : 'bg-slate-950 text-slate-200 hover:bg-slate-800'
                                } ${isCentre ? 'ring-1 ring-cyan-500/50' : ''}`}
                            >
                                {value}
                            </button>
                        );
                    })}
                </div>
            )}

            {state === 'done' && (
                <div className="text-center">
                    <h2 className="text-3xl font-bold text-white mb-2">Table Complete</h2>
                    <div className="text-5xl font-black text-cyan-400 my-4">{score}<span className="text-xl ml-1">s</span></div>
                    <p className="text-slate-400 mb-2">
                        {elapsed.toFixed(1)}s{misses > 0 && ` plus ${misses}s of wrong clicks`}
                    </p>
                    {previousBest !== null && (
                        <p className="text-sm mb-6 font-medium">
                            {score < previousBest
                                ? <span className="text-cyan-400">New best — {(previousBest - score).toFixed(1)}s faster.</span>
                                : <span className="text-slate-500">Best remains {previousBest}s.</span>}
                        </p>
                    )}
                    <button
                        onClick={() => onFinish(score, { seconds: Math.round(elapsed * 10) / 10, misses })}
                        className="bg-slate-800 hover:bg-slate-700 transition-colors text-white px-6 py-3 rounded-xl font-bold"
                    >
                        Save Result
                    </button>
                </div>
            )}
        </div>
    );
}
