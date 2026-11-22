import { weekSummary } from '../lib/dashboard';

/** A change against last week, as a small label: +12%, −3, or "new". */
function Change({ now, before, format = (v) => v, invert = false }) {
    if (now === null || now === undefined) return null;
    if (before === null || before === undefined || before === 0) {
        return now > 0 ? <span className="text-[11px] text-slate-500">new this week</span> : null;
    }
    const diff = now - before;
    if (diff === 0) return <span className="text-[11px] text-slate-500">same as last week</span>;
    const good = invert ? diff < 0 : diff > 0;
    return (
        <span className={`text-[11px] ${good ? 'text-emerald-400' : 'text-amber-400'}`}>
            {diff > 0 ? '+' : '−'}{format(Math.abs(diff))} vs last week
        </span>
    );
}

function Tile({ label, value, children }) {
    return (
        <div className="bg-slate-950/60 border border-slate-800 rounded-2xl px-4 py-3 min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
            <div className="text-xl font-bold text-white mt-0.5 truncate">{value}</div>
            <div className="mt-0.5 h-4">{children}</div>
        </div>
    );
}

/**
 * The last seven days against the seven before: time read, words, checkpoint
 * accuracy, and the fastest speed held at 80%+ of checkpoints right.
 */
export default function WeekSummary({ history, checkpointLog }) {
    const { current, previous } = weekSummary(history, checkpointLog);
    if (current.sessions === 0 && current.checks === 0 && previous.sessions === 0) return null;

    return (
        <section aria-label="This week" className="bg-slate-900 border border-slate-800 rounded-3xl p-5">
            <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-lg font-bold text-white">This week</h2>
                <span className="text-xs text-slate-500">last 7 days</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label="Reading time" value={`${current.minutes} min`}>
                    <Change now={current.minutes} before={previous.minutes} format={(v) => `${v} min`} />
                </Tile>
                <Tile label="Words read" value={current.words.toLocaleString()}>
                    <Change now={current.words} before={previous.words} format={(v) => v.toLocaleString()} />
                </Tile>
                <Tile label="Checkpoints right" value={current.checkPct === null ? '—' : `${current.checkPct}%`}>
                    {current.checkPct !== null && <Change now={current.checkPct} before={previous.checkPct} format={(v) => `${v} pts`} />}
                </Tile>
                <Tile label="Speed held at 80%+" value={current.solidWpm === null ? '—' : `${current.solidWpm}+ WPM`}>
                    {current.solidWpm === null
                        ? <span className="text-[11px] text-slate-500">needs 3+ checks at one speed</span>
                        : <Change now={current.solidWpm} before={previous.solidWpm} format={(v) => `${v} WPM`} />}
                </Tile>
            </div>
        </section>
    );
}
