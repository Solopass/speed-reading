import { Activity, BarChart2, Bookmark, ChevronRight, Play, Shield, Target, TrendingUp, Zap } from 'lucide-react';
import {
    CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis
} from 'recharts';
import {
    averageComprehension, baselineDelta, goalProgress, level, recentEffectiveWpm,
    scoredSessions, sessionsToGoal
} from '../lib/stats';
import StatCard from '../components/StatCard';

function Dashboard({ stats, history, settings, recallDue = [], onStart, onCalibrate, onRecall }) {
    const hasBaseline = stats.baselineWpm !== null;
    // The speed actually in force. With adaptation off that is the locked
    // setting, and every number below has to agree with the card above it.
    const openingWpm = settings.autoAdaptive ? stats.targetWpm : settings.baseWpm;
    const delta = baselineDelta(stats, openingWpm);
    const toGoal = sessionsToGoal(openingWpm, settings.goalWpm);
    const progressPct = goalProgress(stats, settings.goalWpm, openingWpm);
    // Everything here is derived from history rather than stored, so the cards
    // can never drift out of sync with the sessions that produced them.
    const eWpm = recentEffectiveWpm(history, 5);
    const comprehension = averageComprehension(history);
    const scored = scoredSessions(history);

    return (
        <div className="space-y-8 animate-in fade-in zoom-in-95 duration-300">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Welcome back.</h1>
                    <p className="text-slate-400 mt-1">Ready to push your cognitive limits?</p>
                </div>
                <button
                    onClick={hasBaseline ? onStart : onCalibrate}
                    className="bg-purple-600 hover:bg-purple-500 text-white px-8 py-4 rounded-2xl font-bold transition-all shadow-lg shadow-purple-900/30 flex items-center justify-center gap-2 group"
                >
                    {hasBaseline ? <Play className="w-5 h-5 fill-current" /> : <Target className="w-5 h-5" />}
                    <span>{hasBaseline ? 'Start Training' : 'Run Baseline Test'}</span>
                </button>
            </header>

            {!hasBaseline && (
                <div className="bg-purple-950/30 border border-purple-800/50 rounded-3xl p-6 flex flex-col md:flex-row md:items-center gap-4">
                    <div className="p-3 bg-purple-500/20 rounded-xl text-purple-400 w-fit shrink-0"><Target size={24} /></div>
                    <div>
                        <h3 className="font-bold text-white">Set your baseline first</h3>
                        <p className="text-sm text-slate-400 mt-1">
                            Your target speed is a placeholder until you take the baseline test — one short passage read at your natural pace, then five questions.
                            It takes about two minutes, needs no API key, and gives every later number something real to measure against.
                        </p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    icon={<Zap />} label="Target Speed" value={`${openingWpm}`} color="text-amber-400"
                    subtitle={
                        !hasBaseline ? 'Placeholder — run the baseline test'
                            : delta === null ? `Peak ${stats.highestWpm} WPM`
                                // A locked target never moving is a setting, not a
                                // plateau, so say which one you are looking at.
                                : `${settings.autoAdaptive ? 'Adaptive' : 'Locked'} · ${delta >= 0 ? '+' : ''}${delta}% vs baseline`
                    }
                />
                <StatCard
                    icon={<TrendingUp />} label="Effective WPM" value={eWpm ?? '—'} color="text-emerald-400"
                    subtitle={eWpm === null ? 'Needs a quizzed session' : `Speed × retention, last ${scored.slice(-5).length}`}
                />
                <StatCard
                    icon={<Target />} label="Comprehension" value={comprehension === null ? '—' : `${comprehension}%`} color="text-blue-400"
                    subtitle={comprehension === null ? 'No quizzes taken yet' : `Across ${scored.length} quizzed session${scored.length === 1 ? '' : 's'}`}
                />

                {settings.rpgLeveling ? (
                    <StatCard icon={<Shield />} label="Neuro-Tier" value={`Level ${level(history)}`} subtitle="Based on 5-session eWPM" color="text-purple-400" />
                ) : (
                    <StatCard icon={<Activity />} label="Streak" value={`${stats.streak} ${stats.streak === 1 ? 'Day' : 'Days'}`} subtitle="Consecutive days trained" color="text-orange-400" />
                )}
            </div>

            {recallDue.length > 0 && (
                <div className="bg-slate-900 border border-purple-800/50 rounded-3xl p-6 md:p-8">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400"><Bookmark size={18} /></div>
                        <h2 className="text-xl font-bold text-white">Retention check due</h2>
                    </div>
                    <p className="text-sm text-slate-400 mb-5">
                        Reading fast only counts if it stays with you. Re-answer the questions on {recallDue.length === 1 ? 'this passage' : 'these passages'} without re-reading.
                    </p>
                    <div className="space-y-2">
                        {recallDue.slice(0, 4).map(item => (
                            <button
                                key={item.id}
                                onClick={() => onRecall(item.id)}
                                className="w-full flex items-center justify-between gap-4 bg-slate-950 border border-slate-800 hover:border-purple-500 rounded-2xl p-4 text-left transition-colors group"
                            >
                                <div className="min-w-0">
                                    <div className="font-bold text-white truncate">{item.title}</div>
                                    <div className="text-xs text-slate-500 mt-1">
                                        Last read {item.lastReadAt} · {item.attempts.length} attempt{item.attempts.length === 1 ? '' : 's'}
                                    </div>
                                </div>
                                <ChevronRight size={18} className="text-slate-600 group-hover:text-purple-400 transition-colors shrink-0" />
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {hasBaseline && (
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8">
                    <div className="flex items-end justify-between mb-4 flex-wrap gap-2">
                        <div>
                            <h2 className="text-xl font-bold text-white">Road to {settings.goalWpm} WPM</h2>
                            <p className="text-sm text-slate-400 mt-1">
                                {toGoal === 0
                                    ? 'Goal reached. Raise it in Settings.'
                                    : settings.autoAdaptive
                                        ? `${toGoal} more perfect sessions at the current climb rate — a floor, since it assumes you never miss a question.`
                                        : `${toGoal} steps of 5% away. Your speed is locked, so that climb is yours to make in Settings.`}
                            </p>
                        </div>
                        <div className="text-right">
                            <div className="text-2xl font-black text-white">{progressPct}%</div>
                            <div className="text-xs text-slate-500 uppercase tracking-wider font-bold">of the way</div>
                        </div>
                    </div>
                    <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-purple-600 to-amber-400 transition-all duration-500" style={{ width: `${progressPct}%` }} />
                    </div>
                    <div className="flex justify-between mt-2 text-xs text-slate-500 font-mono">
                        <span>{stats.baselineWpm} baseline</span>
                        <span className="text-purple-400">{openingWpm} now</span>
                        <span>{settings.goalWpm} goal</span>
                    </div>
                </div>
            )}

            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold text-white">Recent Performance</h2>
                    <span className="text-sm text-slate-400">{scored.length} quizzed {scored.length === 1 ? 'session' : 'sessions'}</span>
                </div>
                {scored.length > 0 ? (
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={scored} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                <XAxis dataKey="id" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                                <RechartsTooltip
                                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px' }}
                                    itemStyle={{ color: '#c084fc' }}
                                />
                                <Line type="monotone" dataKey="effectiveWpm" name="Effective WPM" stroke="#a855f7" strokeWidth={3} dot={{ r: 4, fill: '#a855f7' }} activeDot={{ r: 6 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="h-64 flex items-center justify-center text-slate-500 flex-col gap-3">
                        <BarChart2 className="w-12 h-12 opacity-20" />
                        <p>{history.length > 0 ? 'Practice logged, but no quizzed sessions yet.' : 'No training history yet. Start a session!'}</p>
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * A retention check: the questions from a passage you finished days ago, with
 * no text in front of you. Measures whether the reading stuck, which is the
 * only thing that makes reading fast worth anything.
 */

export default Dashboard;
