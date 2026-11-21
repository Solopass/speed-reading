import { useEffect } from 'react';
import { Check, X } from 'lucide-react';

/**
 * A quick fill-the-blank check on a sentence just read. Keys 1-4 answer,
 * Space or Enter continues once answered, Escape skips the check entirely.
 */
export default function CheckpointCard({ checkpoint, stats, onAnswer, onContinue, onSkip, onTurnOff }) {
    const { cloze, picked } = checkpoint;
    const answered = picked !== null;
    const correct = answered && picked === cloze.answerIndex;

    useEffect(() => {
        const onKey = (e) => {
            // Only the keys for choices that exist (three for a sentence check).
            const n = Number(e.key);
            if (Number.isInteger(n) && n >= 1 && n <= cloze.options.length && !answered) { e.preventDefault(); onAnswer(n - 1); }
            else if ((e.key === ' ' || e.key === 'Enter') && answered) { e.preventDefault(); onContinue(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onSkip(); }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [answered, onAnswer, onContinue, onSkip, cloze.options.length]);

    return (
        <div className="fixed inset-0 z-[56] grid place-items-center p-4 bg-black/50">
            <div role="dialog" aria-label="Checkpoint" className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-bold uppercase tracking-widest text-purple-300">Checkpoint</span>
                    <span>{stats.asked > 0 ? `${stats.right}/${stats.asked} this session` : cloze.kind === 'sentence' ? 'Pick one' : 'Which word was it?'}</span>
                </div>
                <p className="text-lg leading-relaxed text-slate-100" style={{ fontFamily: 'var(--reading-font)' }}>{cloze.sentence ?? cloze.prompt}</p>
                {/* Whole sentences need a line each; single words fit two to a row. */}
                <div className={`grid gap-2 ${cloze.kind === 'sentence' ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    {cloze.options.map((o, i) => {
                        const isAnswer = i === cloze.answerIndex;
                        const tone = !answered ? 'border-slate-700 hover:border-purple-500 text-slate-200'
                            : isAnswer ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200'
                                : i === picked ? 'border-red-500 bg-red-500/10 text-red-200' : 'border-slate-800 text-slate-500';
                        return (
                            <button
                                key={o} type="button" disabled={answered} onClick={() => onAnswer(i)}
                                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left font-medium transition-colors ${tone}`}
                            >
                                <span className="font-mono text-[11px] text-slate-500">{i + 1}</span>
                                <span className="flex-1">{o}</span>
                                {answered && isAnswer && <Check size={15} />}
                                {answered && i === picked && !isAnswer && <X size={15} />}
                            </button>
                        );
                    })}
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                    <button type="button" onClick={onTurnOff} className="text-xs text-slate-500 hover:text-slate-300">
                        Turn checkpoints off
                    </button>
                    {answered ? (
                        <button type="button" onClick={onContinue} className="px-4 py-2 rounded-xl text-sm font-bold bg-purple-600 hover:bg-purple-500 text-white">
                            {correct ? 'Right. Continue' : 'Continue'} <span className="opacity-60 font-normal">(space)</span>
                        </button>
                    ) : (
                        <button type="button" onClick={onSkip} className="text-xs text-slate-400 hover:text-white">Skip (esc)</button>
                    )}
                </div>
            </div>
        </div>
    );
}
