import { useState } from 'react';
import { Brain, Target } from 'lucide-react';
import { coachSpec } from '../lib/ai';
import { generateJson } from '../lib/gemini';
import { averageComprehension, recentEffectiveWpm, scoredSessions } from '../lib/stats';
import ManualAiPanel from '../components/ManualAiPanel';

function AICoach({ stats, history, useApi, addNotification }) {
    const [analysis, setAnalysis] = useState(null);
    const [loading, setLoading] = useState(false);

    const scored = scoredSessions(history);
    const eWpm = recentEffectiveWpm(history, 5);
    const comprehension = averageComprehension(history);

    // The last few sessions matter more than the aggregate — a coach needs the
    // trend, not just the average.
    const spec = coachSpec({
        stats, effectiveWpm: eWpm, comprehension, scoredCount: scored.length,
        recent: scored.slice(-8).map(s => `${s.wpm} WPM / ${s.comprehension}% retention`).join('; ')
    });

    // Shared by the API call and the copy/paste panel.
    const acceptAnalysis = (data) => {
        if (!data?.grade) throw new Error('That reply has no grade in it.');
        setAnalysis(data);
        addNotification('Diagnostic report ready.');
    };

    const generateInsights = async () => {
        setLoading(true);
        addNotification("Running deep-learning diagnostic...");
        try {
            acceptAnalysis(await generateJson({ prompt: spec.prompt, schema: spec.schema }));
        } catch (error) {
            console.error("AI Diagnostic Error:", error);
            addNotification(error.message || "Diagnostic failed.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 pb-12">
             <div>
                <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                    <Target className="text-purple-500 w-8 h-8"/> AI Coach
                </h1>
                <p className="text-slate-400 mt-2">Get personalized insights and training prescriptions powered by Gemini.</p>
            </div>

            {!analysis ? (
                <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl text-center">
                    <Brain className="w-16 h-16 text-purple-500 mx-auto mb-6 opacity-50" />
                    {useApi ? (
                        <button
                            onClick={generateInsights}
                            disabled={loading || scored.length === 0}
                            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-8 py-3 rounded-xl font-bold transition-all"
                        >
                            {loading ? 'Analyzing Profile...' : 'Generate Diagnostic'}
                        </button>
                    ) : (
                        <div className="text-left max-w-md mx-auto">
                            <ManualAiPanel spec={spec} disabled={scored.length === 0} addNotification={addNotification} onResult={acceptAnalysis} />
                        </div>
                    )}
                    {scored.length === 0 && <p className="text-slate-500 text-sm mt-4">Complete a session with a comprehension quiz to get feedback — practice runs alone don’t measure retention.</p>}
                </div>
            ) : (
                <div className="space-y-6 animate-in zoom-in-95">
                    <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl text-center">
                        <div className="text-6xl font-black text-purple-400 mb-2">{analysis.grade}</div>
                        <div className="text-slate-400 font-bold uppercase tracking-widest text-sm">Overall Grade</div>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
                        <h3 className="text-lg font-bold text-white mb-2">Diagnosis</h3>
                        <p className="text-slate-300 leading-relaxed">{analysis.diagnosis}</p>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
                        <h3 className="text-lg font-bold text-white mb-2">Prescription</h3>
                        <p className="text-slate-300 leading-relaxed">{analysis.prescription}</p>
                    </div>
                    <button onClick={() => setAnalysis(null)} className="w-full py-3 text-slate-400 hover:text-white font-medium bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors">Reset Diagnostic</button>
                </div>
            )}
        </div>
    );
}

export default AICoach;
