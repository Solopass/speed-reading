import { useState } from 'react';

const W = 560;
const H = 120;
const PAD = { top: 10, right: 8, bottom: 18, left: 34 };

/**
 * Measured reading speed for each finished chapter of a book: one bar per
 * chapter in book order (unread chapters leave a gap), a dashed line at the
 * book's average, and a tooltip on hover or focus. A plain table carries the
 * same numbers for screen readers.
 */
export default function ChapterSpeedChart({ speeds, totalChapters }) {
    const [hover, setHover] = useState(null);
    if (speeds.length < 2) return null;

    const max = Math.max(...speeds.map(s => s.wpm));
    const top = Math.ceil((max * 1.1) / 50) * 50;
    const avg = Math.round(speeds.reduce((s, x) => s + x.wpm, 0) / speeds.length);
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const slot = plotW / Math.max(1, totalChapters);
    // Thin bars with a clear gap between neighbours.
    const barW = Math.max(3, Math.min(18, slot - 2));
    const y = (v) => PAD.top + plotH - (v / top) * plotH;
    const shown = hover !== null ? speeds[hover] : null;

    return (
        <div className="relative mt-3">
            <div className="text-xs font-bold text-slate-400 mb-1">Speed by chapter</div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Reading speed by chapter. Average ${avg} WPM.`}>
                {/* Recessive axis: a baseline and the top value only. */}
                <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-slate-700" strokeWidth="1" />
                <text x={PAD.left - 6} y={y(top) + 4} textAnchor="end" className="fill-slate-500" fontSize="10">{top}</text>
                <text x={PAD.left - 6} y={y(0)} textAnchor="end" className="fill-slate-500" fontSize="10">0</text>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(avg)} y2={y(avg)} stroke="currentColor" className="text-slate-500" strokeWidth="1" strokeDasharray="4 3" />
                <text x={W - PAD.right} y={y(avg) - 3} textAnchor="end" className="fill-slate-400" fontSize="10">avg {avg}</text>
                {speeds.map((s, i) => {
                    const cx = PAD.left + slot * (s.chapter + 0.5);
                    const h = Math.max(1, y(0) - y(s.wpm));
                    const x = cx - barW / 2;
                    const r = Math.min(4, barW / 2, h);
                    // Rounded at the data end, square at the baseline.
                    const d = `M${x},${y(0)} V${y(s.wpm) + r} Q${x},${y(s.wpm)} ${x + r},${y(s.wpm)} H${x + barW - r} Q${x + barW},${y(s.wpm)} ${x + barW},${y(s.wpm) + r} V${y(0)} Z`;
                    return (
                        <g key={s.chapter}>
                            <path d={d} className={hover === i ? 'fill-purple-300' : 'fill-purple-500'} />
                            {/* Hit target taller and wider than the bar. */}
                            <rect
                                x={cx - slot / 2} y={PAD.top} width={slot} height={plotH} fill="transparent"
                                tabIndex={0} role="presentation" style={{ outline: 'none' }}
                                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                                onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                            />
                        </g>
                    );
                })}
                <text x={PAD.left} y={H - 4} className="fill-slate-500" fontSize="10">Ch 1</text>
                <text x={W - PAD.right} y={H - 4} textAnchor="end" className="fill-slate-500" fontSize="10">Ch {totalChapters}</text>
            </svg>
            {shown && (
                <div
                    className="pointer-events-none absolute -translate-x-1/2 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs shadow-xl whitespace-nowrap"
                    style={{ left: `${((PAD.left + slot * (shown.chapter + 0.5)) / W) * 100}%`, top: '1.4rem' }}
                >
                    <div className="text-slate-400">Ch {shown.chapter + 1} · {shown.title.slice(0, 40)}</div>
                    <div className="text-white font-bold">{shown.wpm} WPM{shown.score !== null ? <span className="text-slate-400 font-normal"> · {shown.score}% quiz</span> : null}</div>
                </div>
            )}
            <table className="sr-only">
                <caption>Reading speed by chapter</caption>
                <thead><tr><th>Chapter</th><th>WPM</th><th>Quiz</th></tr></thead>
                <tbody>
                    {speeds.map(s => <tr key={s.chapter}><td>{s.chapter + 1}. {s.title}</td><td>{s.wpm}</td><td>{s.score ?? '—'}</td></tr>)}
                </tbody>
            </table>
        </div>
    );
}
