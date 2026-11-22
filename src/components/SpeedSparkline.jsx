/** A tiny speed trend for one passage: each attempt's WPM, oldest to newest. */
export default function SpeedSparkline({ values, width = 64, height = 18 }) {
    if (!Array.isArray(values) || values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const x = (i) => 1 + (i / (values.length - 1)) * (width - 2);
    const y = (v) => height - 2 - ((v - min) / span) * (height - 4);
    const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const up = values[values.length - 1] >= values[0];
    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
            aria-label={`Speed over ${values.length} reads: ${values[0]} to ${values[values.length - 1]} WPM`}>
            <title>{`${values.join(' → ')} WPM`}</title>
            <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"
                className={up ? 'text-emerald-400' : 'text-amber-400'} />
            <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2" className={up ? 'fill-emerald-400' : 'fill-amber-400'} />
        </svg>
    );
}
