import {
    CartesianGrid, ResponsiveContainer, Scatter, ScatterChart,
    Tooltip as RechartsTooltip, XAxis, YAxis
} from 'recharts';
import { scoredSessions } from '../lib/stats';

function Analytics({ history }) {
    // Only quizzed sessions have a comprehension value to plot against.
    const scored = scoredSessions(history);
    const scatterData = scored.map(s => ({ x: s.wpm, y: s.comprehension, z: s.effectiveWpm }));

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
            <div>
                <h1 className="text-3xl font-bold text-white tracking-tight">Analytics &amp; Insights</h1>
                <p className="text-slate-400 mt-1">Track your cognitive performance over time.</p>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl">
                <h2 className="text-xl font-bold text-white mb-6">Performance Frontier</h2>
                <div className="h-72 w-full">
                    {scored.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                {/* Padded domain so a single session doesn't sit on the axis. */}
                                <XAxis type="number" dataKey="x" name="Raw WPM" stroke="#64748b" domain={['dataMin - 50', 'dataMax + 50']} />
                                <YAxis type="number" dataKey="y" name="Comprehension %" stroke="#64748b" domain={[0, 100]} />
                                <RechartsTooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px', color: '#fff' }} />
                                <Scatter name="Sessions" data={scatterData} fill="#a855f7" />
                            </ScatterChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex items-center justify-center h-full text-slate-500">Complete a quizzed session to plot your frontier.</div>
                    )}
                </div>
                <p className="text-slate-500 text-sm mt-6 text-center">Watch for the drop-off point where speed begins degrading retention.</p>
            </div>
        </div>
    );
}

export default Analytics;
