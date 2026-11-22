import React from 'react';
import {
    ArrowRight, BarChart2, Bookmark, BookOpen, ChevronRight, Flame, HardDriveDownload, Map, Shield, Target, TrendingUp, Zap
} from 'lucide-react';
import {
    CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis
} from 'recharts';
import {
    averageComprehension, baselineDelta, dailyActivity, goalProgress, level, recentEffectiveWpm,
    recentSeries, scoredSessions, sessionsToGoal
} from '../lib/stats';
import { chartColors, tooltipStyle } from '../lib/theme';
import ComprehensionBySpeed from '../components/ComprehensionBySpeed';
import ContinueReading from '../components/ContinueReading';
import WeekSummary from '../components/WeekSummary';

const ACTION_ICONS = { baseline: Target, 'baseline-more': Target, recall: Bookmark, plan: Map, push: Zap, read: BookOpen, book: BookOpen };
const ACTION_CTA = {
    baseline: 'Start the test', 'baseline-more': 'Read it', recall: 'Check now', plan: 'Go', push: 'Choose a passage', read: 'Choose a passage', book: 'Continue'
};

/** A tiny trend line for a stat card. Draws nothing until there are two points. */
function Sparkline({ data, color }) {
    if (data.length < 2) return null;
    return (
        <div className="h-10 -mx-1 mt-3" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                    <YAxis hide domain={['dataMin', 'dataMax']} />
                    <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

function StatTile({ icon, label, value, subtitle, tone, spark, sparkColor }) {
    return (
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl flex flex-col min-w-0">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                <span className={tone}>{React.cloneElement(icon, { size: 16 })}</span>
                {label}
            </div>
            <div className="text-3xl font-black text-white mt-3 tracking-tight tabular-nums">{value}</div>
            <div className="text-xs text-slate-500 mt-1">{subtitle}</div>
            {spark && <Sparkline data={spark} color={sparkColor} />}
        </div>
    );
}

/** Twelve weeks of training days, GitHub-style, Monday at the top. */
function ActivityHeatmap({ history, streak }) {
    const days = dailyActivity(history, 84);
    // Pad the front so columns are whole weeks starting on Monday.
    const [y, m, d] = days[0].date.split('-').map(Number);
    const lead = (new Date(y, m - 1, d).getDay() + 6) % 7;
    const cells = [...Array(lead).fill(null), ...days];
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    const active = days.filter(x => x.sessions > 0).length;

    const shade = (n) => (n === 0 ? 'bg-slate-800/70' : n === 1 ? 'bg-purple-900' : n === 2 ? 'bg-purple-700' : 'bg-purple-500');

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 md:p-6">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <h2 className="text-lg font-bold text-white">Training days</h2>
                <div className="flex items-center gap-4 text-xs text-slate-400">
                    <span className="flex items-center gap-1.5"><Flame size={14} className="text-orange-400" /> {streak} day streak</span>
                    <span>{active} of the last 84 days</span>
                </div>
            </div>
            <div className="flex gap-1 overflow-x-auto pb-1" role="img" aria-label={`Trained on ${active} of the last 84 days`}>
                {weeks.map((week, wi) => (
                    <div key={wi} className="flex flex-col gap-1">
                        {week.map((day, di) => day === null
                            ? <div key={di} className="w-3.5 h-3.5" />
                            : (
                                <div
                                    key={day.date}
                                    title={`${day.date}: ${day.sessions} session${day.sessions === 1 ? '' : 's'}${day.minutes ? `, ${day.minutes} min` : ''}`}
                                    className={`w-3.5 h-3.5 rounded-[4px] ${shade(day.sessions)}`}
                                />
                            ))}
                    </div>
                ))}
            </div>
            <div className="flex items-center justify-end gap-1.5 mt-3 text-[10px] text-slate-500">
                Less
                {[0, 1, 2, 3].map(n => <span key={n} className={`w-2.5 h-2.5 rounded-[3px] ${shade(n)}`} />)}
                More
            </div>
        </div>
    );
}

function Dashboard({
    stats, history, settings, theme, recallDue = [], nextAction, onAction, backupDue, onBackup, onSnoozeBackup, onRecall, onStart,
    backupPaused = false, onAllowBackup, backupFolderName, library = [], onContinue
}) {
    const colors = chartColors(theme);
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
    const recent = scored.slice(-20);

    const ActionIcon = ACTION_ICONS[nextAction?.kind] ?? Zap;

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">
                        {history.length === 0 ? 'Welcome.' : 'Welcome back.'}
                    </h1>
                    <p className="text-slate-400 mt-1 text-sm md:text-base">
                        {hasBaseline
                            ? `Reading at ${openingWpm} WPM${delta !== null ? `, ${delta >= 0 ? '+' : ''}${delta}% since your baseline` : ''}.`
                            : 'Start with a two-minute baseline so every number has a zero point.'}
                    </p>
                </div>
                {hasBaseline && (
                    <button onClick={onStart} className="text-sm font-bold text-purple-400 hover:text-purple-300 flex items-center gap-1 self-start sm:self-auto">
                        All reading options <ChevronRight size={16} />
                    </button>
                )}
            </header>

            {onContinue && <ContinueReading library={library} mode={settings.readerMode} onContinue={onContinue} />}

            {nextAction && (
                <section className="relative overflow-hidden rounded-3xl border border-purple-800/60 bg-gradient-to-br from-purple-950/60 via-slate-900 to-slate-900 p-5 md:p-7" aria-label="Do this next">
                    <div className="flex flex-col md:flex-row md:items-center gap-5">
                        <div className="shrink-0 w-12 h-12 rounded-2xl bg-purple-600 text-white grid place-items-center shadow-lg shadow-purple-900/40">
                            <ActionIcon size={22} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-bold uppercase tracking-widest text-purple-400">Do this next</div>
                            <h2 className="text-xl font-bold text-white mt-1 truncate">{nextAction.title}</h2>
                            <p className="text-sm text-slate-400 mt-1">{nextAction.detail}</p>
                        </div>
                        <button
                            onClick={() => onAction(nextAction)}
                            className="shrink-0 bg-purple-600 hover:bg-purple-500 text-white px-6 py-3.5 rounded-2xl font-bold transition-colors flex items-center justify-center gap-2"
                        >
                            {ACTION_CTA[nextAction.kind] ?? 'Start'} <ArrowRight size={18} />
                        </button>
                    </div>
                </section>
            )}

            {backupPaused && (
                // The browser forgets folder access after a restart; one click restores it.
                <div className="rounded-2xl border border-amber-800/60 bg-amber-950/30 p-4 flex flex-col sm:flex-row sm:items-center gap-3" role="status">
                    <HardDriveDownload size={20} className="text-amber-400 shrink-0" />
                    <p className="text-sm text-slate-300 flex-1">
                        <strong className="text-white">Automatic backups are paused.</strong> The browser needs your OK again to write to {backupFolderName ? `"${backupFolderName}"` : 'your backup folder'}.
                    </p>
                    <button onClick={onAllowBackup} className="bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors">
                        Allow backups
                    </button>
                </div>
            )}

            {backupDue && !backupPaused && (
                <div className="rounded-2xl border border-amber-800/60 bg-amber-950/30 p-4 flex flex-col sm:flex-row sm:items-center gap-3" role="status">
                    <HardDriveDownload size={20} className="text-amber-400 shrink-0" />
                    <p className="text-sm text-slate-300 flex-1">
                        <strong className="text-white">Back up your progress.</strong> It lives only in this browser; clearing site data would lose it.
                    </p>
                    <div className="flex gap-2">
                        <button onClick={onBackup} className="bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors">
                            Download backup
                        </button>
                        <button onClick={onSnoozeBackup} className="text-slate-400 hover:text-white text-sm font-medium px-3">Later</button>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                <StatTile
                    icon={<Zap />} label="Target" tone="text-amber-400"
                    value={openingWpm}
                    subtitle={!hasBaseline ? 'Placeholder until the baseline'
                        : `${settings.autoAdaptive ? 'Adaptive' : 'Locked'} · peak ${stats.highestWpm}`}
                    spark={recentSeries(history, 'wpm')} sparkColor={colors.warn}
                />
                <StatTile
                    icon={<TrendingUp />} label="Effective WPM" tone="text-emerald-400"
                    value={eWpm ?? '—'}
                    subtitle={eWpm === null ? 'Needs a quizzed session' : `Speed × retention, last ${Math.min(5, scored.length)}`}
                    spark={recentSeries(history, 'effectiveWpm')} sparkColor={colors.good}
                />
                <StatTile
                    icon={<Target />} label="Comprehension" tone="text-blue-400"
                    value={comprehension === null ? '—' : `${comprehension}%`}
                    subtitle={comprehension === null ? 'No quizzes yet' : `Across ${scored.length} quizzed`}
                    spark={recentSeries(history, 'comprehension')} sparkColor={colors.info}
                />
                {settings.rpgLeveling ? (
                    <StatTile icon={<Shield />} label="Level" tone="text-purple-400" value={level(history)} subtitle="Recent eWPM ÷ 50" />
                ) : (
                    <StatTile icon={<Flame />} label="Streak" tone="text-orange-400" value={`${stats.streak}d`} subtitle="Consecutive days trained" />
                )}
            </div>

            {recallDue.length > 1 && (
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 md:p-6">
                    <div className="flex items-center gap-2 mb-3">
                        <Bookmark size={16} className="text-purple-400" />
                        <h2 className="text-lg font-bold text-white">Retention checks due</h2>
                        <span className="text-xs text-slate-500 ml-auto">{recallDue.length}</span>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2">
                        {recallDue.slice(0, 6).map(item => (
                            <button
                                key={item.id} onClick={() => onRecall(item.id)}
                                className="flex items-center justify-between gap-3 bg-slate-950 border border-slate-800 hover:border-purple-500 rounded-2xl px-4 py-3 text-left transition-colors group"
                            >
                                <div className="min-w-0">
                                    <div className="font-bold text-white text-sm truncate">{item.title}</div>
                                    <div className="text-xs text-slate-500 mt-0.5">Last read {item.lastReadAt}</div>
                                </div>
                                <ChevronRight size={16} className="text-slate-600 group-hover:text-purple-400 shrink-0" />
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <WeekSummary history={history} checkpointLog={settings.checkpointLog} />

            <div className="grid lg:grid-cols-5 gap-4">
                <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-3xl p-5 md:p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-bold text-white">Recent performance</h2>
                        <span className="text-xs text-slate-500">{scored.length} quizzed {scored.length === 1 ? 'session' : 'sessions'}</span>
                    </div>
                    {recent.length > 0 ? (
                        <div className="h-60 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={recent} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
                                    <XAxis dataKey="id" stroke={colors.axis} fontSize={11} tickLine={false} axisLine={false} />
                                    <YAxis stroke={colors.axis} fontSize={11} tickLine={false} axisLine={false} />
                                    <RechartsTooltip {...tooltipStyle(theme)} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Line type="monotone" dataKey="wpm" name="Raw WPM" stroke={colors.muted} strokeWidth={2} dot={false} strokeDasharray="4 4" />
                                    <Line type="monotone" dataKey="effectiveWpm" name="Effective WPM" stroke={colors.accent} strokeWidth={3} dot={{ r: 3, fill: colors.accent }} activeDot={{ r: 5 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="h-60 flex items-center justify-center text-slate-500 flex-col gap-3 text-sm text-center">
                            <BarChart2 className="w-10 h-10 opacity-30" />
                            <p>{history.length > 0 ? 'Practice logged, but no quizzed sessions yet.' : 'Your sessions will chart here.'}</p>
                        </div>
                    )}
                </div>

                <div className="lg:col-span-2 space-y-4">
                    {Array.isArray(settings.checkpointLog) && settings.checkpointLog.some(e => Number.isFinite(e?.wpm)) && (
                        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 md:p-6">
                            <h2 className="text-lg font-bold text-white mb-1">Comprehension at speed</h2>
                            <p className="text-xs text-slate-500 mb-3">How often you got reader checkpoints right, by the speed you were reading at.</p>
                            <ComprehensionBySpeed log={settings.checkpointLog} />
                        </div>
                    )}
                    {hasBaseline && (
                        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 md:p-6">
                            <div className="flex items-end justify-between mb-3 gap-2">
                                <div>
                                    <h2 className="text-lg font-bold text-white">Road to {settings.goalWpm}</h2>
                                    <p className="text-xs text-slate-400 mt-1">
                                        {toGoal === 0
                                            ? 'Goal reached. Raise it in Settings.'
                                            : settings.autoAdaptive
                                                ? `At least ${toGoal} perfect sessions away.`
                                                : `${toGoal} steps of 5%. Speed is locked in Settings.`}
                                    </p>
                                </div>
                                <div className="text-2xl font-black text-white tabular-nums">{progressPct}%</div>
                            </div>
                            <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-purple-600 to-amber-400 transition-all duration-500" style={{ width: `${progressPct}%` }} />
                            </div>
                            <div className="flex justify-between mt-2 text-[11px] text-slate-500 font-mono">
                                <span>{stats.baselineWpm} base</span>
                                <span className="text-purple-400">{openingWpm} now</span>
                                <span>{settings.goalWpm} goal</span>
                            </div>
                        </div>
                    )}
                    <ActivityHeatmap history={history} streak={stats.streak} />
                </div>
            </div>
        </div>
    );
}

export default Dashboard;
