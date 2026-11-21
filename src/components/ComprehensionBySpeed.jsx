import { useState } from 'react';
import { checkpointsBySpeed } from '../lib/checkpoint';

const W = 520;
const H = 150;
const PAD = { top: 12, right: 8, bottom: 26, left: 34 };

/**
 * Checkpoint accuracy by the speed you were reading at. One bar per 100-WPM
 * band; bands with fewer than three checks are drawn faint, because one lucky
 * or unlucky answer says little. A dashed line marks 80%, a comfortable target.
 */
export default function ComprehensionBySpeed({ log }) {
    const [hover, setHover] = useState(null);
    const bands = checkpointsBySpeed(log);
    const total = bands.reduce((n, b) => n + b.n, 0);

    if (bands.length === 0) {
        return (
            <p className="text-sm text-slate-500 py-6 text-center">
                Checkpoints in the reader will chart here: how often you get them right at each speed.
            </p>
        );
    }

    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const slot = plotW / bands.length;
    const barW = Math.max(6, Math.min(36, slot - 8));
    const y = (pct) => PAD.top + plotH - (pct / 100) * plotH;
    const shown = hover !== null ? bands[hover] : null;

    return (
        <div className="relative">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Checkpoint accuracy by reading speed, ${total} checks`}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-slate-700" />
                <line x1={PAD.left} x2={W - PAD.right} y1={y(80)} y2={y(80)} stroke="currentColor" className="text-slate-600" strokeDasharray="4 3" />
                <text x={PAD.left - 6} y={y(100) + 4} textAnchor="end" fontSize="10" className="fill-slate-500">100%</text>
                <text x={PAD.left - 6} y={y(80) + 4} textAnchor="end" fontSize="10" className="fill-slate-500">80%</text>
                <text x={PAD.left - 6} y={y(0)} textAnchor="end" fontSize="10" className="fill-slate-500">0</text>
                {bands.map((b, i) => {
                    const cx = PAD.left + slot * (i + 0.5);
                    const top = y(Math.max(2, b.pct));
                    const h = y(0) - top;
                    const x = cx - barW / 2;
                    const r = Math.min(4, barW / 2, h);
                    const d = `M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${y(0)} Z`;
                    return (
                        <g key={b.from}>
                            <path d={d} className={hover === i ? 'fill-purple-300' : 'fill-purple-500'} opacity={b.n < 3 ? 0.4 : 1} />
                            <text x={cx} y={H - 8} textAnchor="middle" fontSize="10" className="fill-slate-500">{b.from}</text>
                            <rect
                                x={cx - slot / 2} y={PAD.top} width={slot} height={plotH + 14} fill="transparent"
                                tabIndex={0} role="presentation" style={{ outline: 'none' }}
                                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                                onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                            />
                        </g>
                    );
                })}
            </svg>
            {shown && (
                <div
                    className="pointer-events-none absolute -translate-x-1/2 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs shadow-xl whitespace-nowrap"
                    style={{ left: `${((PAD.left + slot * (hover + 0.5)) / W) * 100}%`, top: '0.25rem' }}
                >
                    <div className="text-slate-400">{shown.from}–{shown.to} WPM</div>
                    <div className="text-white font-bold">{shown.pct}% right <span className="text-slate-400 font-normal">({shown.right} of {shown.n})</span></div>
                </div>
            )}
            <p className="text-[11px] text-slate-500 mt-1">WPM you were reading at · faint bars have fewer than 3 checks · dashed line is 80%</p>
            <table className="sr-only">
                <caption>Checkpoint accuracy by reading speed</caption>
                <thead><tr><th>Speed (WPM)</th><th>Right</th><th>Checks</th></tr></thead>
                <tbody>{bands.map(b => <tr key={b.from}><td>{b.from}–{b.to}</td><td>{b.pct}%</td><td>{b.n}</td></tr>)}</tbody>
            </table>
        </div>
    );
}
