import {
    Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Scatter, ScatterChart,
    Tooltip as RechartsTooltip, XAxis, YAxis, ZAxis
} from 'recharts';
import { Clock, Gauge, Layers, TrendingUp } from 'lucide-react';
import {
    byMode, linearTrend, scoredSessions, skimSessions, weeklyMinutes
} from '../lib/stats';
import { DRILL_KINDS, DRILL_META } from '../lib/drillStats';
import { chartColors, tooltipStyle } from '../lib/theme';

function Panel({ title, subtitle, children, className = '' }) {
    return (
        <section className={`bg-slate-900 border border-slate-800 rounded-3xl p-5 md:p-6 ${className}`}>
            <h2 className="text-lg font-bold text-white">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-1 mb-4">{subtitle}</p>}
            {!subtitle && <div className="mb-4" />}
            {children}
        </section>
    );
}

function Empty({ children }) {
    return <div className="h-56 grid place-items-center text-sm text-slate-500 text-center px-6">{children}</div>;
}

function Summary({ icon, label, value, detail }) {
    return (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">{icon}{label}</div>
            <div className="text-2xl font-black text-white mt-2 tabular-nums">{value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{detail}</div>
        </div>
    );
}

function Analytics({ history, drills = [], stats, theme }) {
    const colors = chartColors(theme);
    const tip = tooltipStyle(theme);
    const scored = scoredSessions(history);
    const skims = skimSessions(history);

    // Effective WPM over time, with a least-squares trend so one good or bad
    // day does not read as a direction.
    const series = scored.map((s, i) => ({ n: i + 1, id: s.id, date: s.date, effectiveWpm: s.effectiveWpm, wpm: s.wpm }));
    const trend = linearTrend(series.map(p => ({ x: p.n, y: p.effectiveWpm })));
    const withTrend = series.map(p => ({ ...p, trend: trend ? Math.round(trend.at(p.n)) : null }));
    const perTen = trend ? Math.round(trend.slope * 10) : null;

    // Frontier: older sessions faded, the last ten highlighted, so you can see
    // whether the cloud is moving right (faster) without dropping (worse recall).
    const recentCut = Math.max(0, scored.length - 10);
    const older = scored.slice(0, recentCut).map(s => ({ x: s.wpm, y: s.comprehension, id: s.id }));
    const latest = scored.slice(recentCut).map(s => ({ x: s.wpm, y: s.comprehension, id: s.id }));

    const modes = byMode(history);
    const weeks = weeklyMinutes(history, 8).map(w => ({ ...w, label: w.week.slice(5) }));
    const totalMinutes = Math.round(history.reduce((sum, s) => sum + (s.elapsedMs ?? 0), 0) / 60000);
    const bestEwpm = scored.length ? Math.max(...scored.map(s => s.effectiveWpm)) : null;
    const bestSkim = skims.length ? Math.max(...skims.map(s => s.wpm)) : null;

    const drillSeries = DRILL_KINDS
        .map(kind => ({ kind, meta: DRILL_META[kind], runs: drills.filter(d => d.kind === kind && Number.isFinite(d.metric)) }))
        .filter(d => d.runs.length > 0);

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Analytics</h1>
                <p className="text-slate-400 mt-1 text-sm">Is the speed real, and is it staying with you?</p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Summary icon={<TrendingUp size={14} className="text-emerald-400" />} label="Best eWPM" value={bestEwpm ?? '—'} detail={`${scored.length} quizzed sessions`} />
                <Summary
                    icon={<Gauge size={14} className="text-amber-400" />} label="Trend"
                    value={perTen === null ? '—' : `${perTen >= 0 ? '+' : ''}${perTen}`}
                    detail={perTen === null ? 'Needs two quizzed sessions' : 'eWPM per 10 sessions'}
                />
                <Summary icon={<Clock size={14} className="text-blue-400" />} label="Time read" value={`${totalMinutes}m`} detail={`${history.length} sessions logged`} />
                <Summary
                    icon={<Layers size={14} className="text-cyan-400" />} label="Best skim"
                    value={bestSkim ?? '—'} detail={bestSkim === null ? 'No skims yet' : `WPM across ${skims.length} skims`}
                />
            </div>

            <Panel title="Effective WPM over time" subtitle="Speed × comprehension for every quizzed session. The dashed line is the trend.">
                {withTrend.length > 0 ? (
                    <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={withTrend} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
                                <XAxis dataKey="id" stroke={colors.axis} fontSize={11} tickLine={false} axisLine={false} minTickGap={16} />
                                <YAxis stroke={colors.axis} fontSize={11} tickLine={false} axisLine={false} />
                                <RechartsTooltip {...tip} />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                <Line type="monotone" dataKey="effectiveWpm" name="Effective WPM" stroke={colors.accent} strokeWidth={3} dot={{ r: 3, fill: colors.accent }} />
                                {trend && <Line type="linear" dataKey="trend" name="Trend" stroke={colors.good} strokeWidth={2} strokeDasharray="6 4" dot={false} />}
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                ) : <Empty>Finish a quizzed session to start this chart.</Empty>}
            </Panel>

            <div className="grid lg:grid-cols-2 gap-6">
                <Panel title="Speed vs comprehension" subtitle="Watch for where speed starts costing recall. Your last ten sessions are highlighted.">
                    {scored.length > 0 ? (
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                                    <XAxis type="number" dataKey="x" name="WPM" stroke={colors.axis} fontSize={11} domain={['dataMin - 50', 'dataMax + 50']} />
                                    <YAxis type="number" dataKey="y" name="Comprehension" unit="%" stroke={colors.axis} fontSize={11} domain={[0, 100]} />
                                    <ZAxis range={[60, 60]} />
                                    <RechartsTooltip cursor={{ strokeDasharray: '3 3' }} {...tip} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    {older.length > 0 && <Scatter name="Earlier" data={older} fill={colors.muted} />}
                                    <Scatter name="Last 10" data={latest} fill={colors.accent} />
                                </ScatterChart>
                            </ResponsiveContainer>
                        </div>
                    ) : <Empty>Complete a quizzed session to plot your frontier.</Empty>}
                </Panel>

                <Panel title="Minutes per week" subtitle="Time actually spent reading, last eight weeks.">
                    {history.length > 0 ? (
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={weeks} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
                                    <XAxis dataKey="label" stroke={colors.axis} fontSize={11} tickLine={false} axisLine={false} />
                                    <YAxis stroke={colors.axis} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                                    <RechartsTooltip {...tip} cursor={{ fill: colors.grid }} />
                                    <Bar dataKey="minutes" name="Minutes" fill={colors.info} radius={[6, 6, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : <Empty>Nothing logged yet.</Empty>}
                </Panel>
            </div>

            <Panel title="By reading mode" subtitle="Averages for quizzed sessions. Skims are judged on gist, so compare them with each other, not with careful reads.">
                {modes.length > 0 ? (
                    <div className="overflow-x-auto -mx-1">
                        <table className="w-full text-sm min-w-[28rem]">
                            <thead>
                                <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                                    <th className="font-bold py-2 px-1">Mode</th>
                                    <th className="font-bold py-2 px-1 text-right">Sessions</th>
                                    <th className="font-bold py-2 px-1 text-right">WPM</th>
                                    <th className="font-bold py-2 px-1 text-right">Comprehension</th>
                                    <th className="font-bold py-2 px-1 text-right">eWPM</th>
                                </tr>
                            </thead>
                            <tbody>
                                {modes.map(row => (
                                    <tr key={row.mode} className="border-t border-slate-800">
                                        <td className="py-2.5 px-1 font-bold text-white">{row.label}</td>
                                        <td className="py-2.5 px-1 text-right text-slate-400 tabular-nums">{row.sessions}</td>
                                        <td className="py-2.5 px-1 text-right text-slate-300 tabular-nums">{row.wpm}</td>
                                        <td className="py-2.5 px-1 text-right text-slate-300 tabular-nums">{row.comprehension}%</td>
                                        <td className="py-2.5 px-1 text-right font-bold text-purple-400 tabular-nums">{row.effectiveWpm}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {modes.some(m => m.mode === 'other') && (
                            <p className="text-[11px] text-slate-600 mt-2 px-1">&ldquo;Other&rdquo; is sessions from before the app recorded which mode you used.</p>
                        )}
                    </div>
                ) : <Empty>No quizzed sessions yet.</Empty>}
            </Panel>

            <Panel title="Drill thresholds" subtitle="Each Neuro-Drill run, oldest to newest.">
                {drillSeries.length > 0 ? (
                    <div className="grid sm:grid-cols-2 gap-4">
                        {drillSeries.map(({ kind, meta, runs }) => {
                            const data = runs.slice(-30).map((r, i) => ({ n: i + 1, v: r.metric }));
                            const last = runs[runs.length - 1].metric;
                            const best = meta.lowerIsBetter ? Math.min(...runs.map(r => r.metric)) : Math.max(...runs.map(r => r.metric));
                            return (
                                <div key={kind} className="bg-slate-950 border border-slate-800 rounded-2xl p-4">
                                    <div className="flex items-baseline justify-between gap-2">
                                        <span className="text-sm font-bold text-white">{meta.label}</span>
                                        <span className="text-xs text-slate-500">{runs.length} runs · {meta.lowerIsBetter ? 'lower' : 'higher'} is better</span>
                                    </div>
                                    <div className="text-xs text-slate-400 mt-1">
                                        Last <span className="font-mono text-slate-200">{last}{meta.unit}</span> · best <span className="font-mono text-emerald-400">{best}{meta.unit}</span>
                                    </div>
                                    <div className="h-24 mt-2">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                                                <YAxis hide domain={['dataMin', 'dataMax']} reversed={meta.lowerIsBetter} />
                                                <RechartsTooltip {...tip} formatter={(v) => [`${v}${meta.unit}`, meta.label]} labelFormatter={(n) => `Run ${n}`} />
                                                <Line type="monotone" dataKey="v" stroke={colors.accentSoft} strokeWidth={2} dot={false} isAnimationActive={false} />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : <Empty>Run a Neuro-Drill to see your thresholds here.</Empty>}
            </Panel>

            {stats?.baselineSamples?.length > 0 && (
                <p className="text-xs text-slate-600 text-center">
                    Baseline {stats.baselineWpm} WPM, averaged over {stats.baselineSamples.length} passage{stats.baselineSamples.length === 1 ? '' : 's'}.
                </p>
            )}
        </div>
    );
}

export default Analytics;
