const W = 480;
const H = 44;
const PAD = 4;

/**
 * Your actual speed over this session, in 10-second steps: one line, amber
 * dots where you held Shift to slow down, red ticks where you went back.
 * Each step has a native tooltip with its time and speed.
 */
export default function SpeedTraceLine({ trace }) {
    const { buckets = [], rewinds = [] } = trace ?? {};
    if (buckets.length < 3) return null;

    const max = Math.max(100, ...buckets.map(b => b.wpm));
    const span = Math.max(1, buckets[buckets.length - 1].t + 10 - buckets[0].t);
    const x = (t) => PAD + ((t - buckets[0].t) / span) * (W - PAD * 2);
    const y = (v) => H - PAD - (v / max) * (H - PAD * 2);
    const points = buckets.map(b => `${x(b.t + 5).toFixed(1)},${y(b.wpm).toFixed(1)}`).join(' ');
    const last = buckets[buckets.length - 1];
    const fmt = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

    return (
        <div className="w-full max-w-lg">
            <div className="flex justify-between text-[10px] text-slate-500 px-0.5">
                <span>Speed this session</span>
                <span className="font-mono">now {last.wpm} WPM · peak {max} WPM</span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-11" role="img" aria-label={`Speed this session, now ${last.wpm} words per minute`}>
                <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="currentColor" className="text-slate-800" strokeWidth="1" />
                <polyline points={points} fill="none" stroke="currentColor" className="text-purple-400" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {buckets.map(b => (
                    <g key={b.t}>
                        {b.slow && <circle cx={x(b.t + 5)} cy={y(b.wpm)} r="3.5" className="fill-amber-400" />}
                        <rect x={x(b.t)} y={0} width={Math.max(2, x(b.t + 10) - x(b.t))} height={H} fill="transparent">
                            <title>{`${fmt(b.t)}: ${b.wpm} WPM${b.slow ? ' (slowed with Shift)' : ''}`}</title>
                        </rect>
                    </g>
                ))}
                {rewinds.map((t, i) => (
                    <line key={i} x1={x(t)} x2={x(t)} y1={H - PAD} y2={H - PAD - 8} stroke="currentColor" className="text-red-400" strokeWidth="2">
                        <title>{`${fmt(t)}: went back`}</title>
                    </line>
                ))}
            </svg>
        </div>
    );
}
