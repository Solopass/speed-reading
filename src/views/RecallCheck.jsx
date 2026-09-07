import { useMemo } from 'react';
import { Bookmark } from 'lucide-react';
import { normalizeQuestions } from '../lib/quiz';
import Quiz from '../components/Quiz';

function RecallCheck({ passage, onDone, onExit }) {
    const questions = useMemo(() => normalizeQuestions(passage?.questions), [passage]);

    if (!passage || questions.length === 0) {
        return (
            <div className="max-w-lg mx-auto mt-20 text-center">
                <p className="text-slate-400 mb-6">This passage has no questions to re-test.</p>
                <button onClick={onExit} className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-3 rounded-xl font-bold transition-colors">Back</button>
            </div>
        );
    }

    return (
        <div>
            <div className="max-w-2xl mx-auto bg-purple-950/30 border border-purple-800/50 rounded-2xl p-4 flex items-center gap-3">
                <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400 shrink-0"><Bookmark size={18} /></div>
                <div className="flex-1 min-w-0">
                    <div className="font-bold text-white text-sm truncate">Retention check · {passage.title}</div>
                    <div className="text-xs text-slate-400">Answer from memory. No speed is recorded — only whether it stuck.</div>
                </div>
                <button onClick={onExit} className="text-slate-400 hover:text-white text-sm font-medium shrink-0">Exit</button>
            </div>
            <Quiz
                questions={questions}
                ctaLabel="Save Result"
                resultNote={(score) => score >= 80
                    ? 'Held up well. Next check is further out.'
                    : score >= 50
                        ? 'Partially retained — worth re-reading this one.'
                        : 'Mostly gone. Speed without retention is not reading.'}
                onDone={onDone}
            />
        </div>
    );
}

export default RecallCheck;
