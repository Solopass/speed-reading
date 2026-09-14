import { useState } from 'react';
import { Brain } from 'lucide-react';
import { scoreQuiz } from '../lib/quiz';

/**
 * Question flow plus the review screen, shared by the reader and the speed-push
 * drill. The caller supplies the surrounding context (measured speed, what the
 * score does to the target) because that differs between the two.
 *
 * Questions arrive already validated and shuffled — see lib/quiz.
 */
export default function Quiz({ questions, onDone, resultSubtitle, resultNote, ctaLabel = 'Log Session' }) {
    const [currentIdx, setCurrentIdx] = useState(0);
    const [answers, setAnswers] = useState([]);
    const [score, setScore] = useState(null);

    const handleAnswer = (choice) => {
        const given = [...answers, choice];
        setAnswers(given);

        if (currentIdx + 1 < questions.length) {
            setCurrentIdx(currentIdx + 1);
            return;
        }
        // Held for review rather than submitted straight through: seeing which
        // questions you missed is the feedback half of the training loop.
        setScore(scoreQuiz(questions, given));
    };

    if (score !== null) {
        const correct = answers.filter((a, i) => a === questions[i].answer).length;

        return (
            <div className="max-w-2xl mx-auto mt-12 animate-in slide-in-from-bottom-8 pb-12">
                <div className="bg-slate-900 border border-slate-800 p-8 md:p-10 rounded-3xl shadow-2xl">
                    <div className="text-center border-b border-slate-800 pb-8 mb-8">
                        <div className="text-6xl font-black text-white mb-2">{score}%</div>
                        <p className="text-slate-400 font-medium">
                            {correct} of {questions.length} correct{resultSubtitle ? ` · ${resultSubtitle(score)}` : ''}
                        </p>
                        {resultNote && <p className="text-sm text-purple-400 mt-3 font-medium">{resultNote(score)}</p>}
                    </div>

                    <div className="space-y-4">
                        {questions.map((q, i) => {
                            const wasRight = answers[i] === q.answer;
                            return (
                                <div key={i} className={`p-4 rounded-2xl border ${wasRight ? 'border-slate-800 bg-slate-950' : 'border-red-900/50 bg-red-950/20'}`}>
                                    <p className="text-sm font-bold text-white mb-2">{q.q}</p>
                                    {wasRight ? (
                                        <p className="text-sm text-emerald-400">✓ {q.options[q.answer]}</p>
                                    ) : (
                                        <>
                                            <p className="text-sm text-red-400 mb-1">✗ You chose: {q.options[answers[i]]}</p>
                                            <p className="text-sm text-emerald-400">✓ Correct: {q.options[q.answer]}</p>
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <button
                        onClick={() => onDone(score)}
                        className="w-full mt-8 bg-purple-600 hover:bg-purple-500 text-white py-4 rounded-xl font-bold transition-colors"
                    >
                        {ctaLabel}
                    </button>
                </div>
            </div>
        );
    }

    const question = questions[currentIdx];

    return (
        <div className="max-w-2xl mx-auto mt-20 animate-in slide-in-from-bottom-8">
            <div className="bg-slate-900 border border-slate-800 p-8 md:p-12 rounded-3xl shadow-2xl text-center">
                <Brain className="w-16 h-16 text-purple-500 mx-auto mb-6 opacity-50" />
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">
                    Comprehension Check {currentIdx + 1}/{questions.length}
                </h2>
                <p className="text-2xl font-bold text-white mb-8">{question.q}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {question.options.map((option, i) => (
                        <button
                            key={i} onClick={() => handleAnswer(i)}
                            className="bg-slate-950 border border-slate-800 hover:border-purple-500 hover:bg-purple-900/20 text-white p-4 rounded-xl font-medium transition-all text-left"
                        >
                            {option}
                        </button>
                    ))}
                </div>
                <div className="flex gap-1.5 justify-center mt-8">
                    {questions.map((_, i) => (
                        <div key={i} className={`h-1.5 rounded-full transition-all ${i < currentIdx ? 'w-8 bg-purple-500' : i === currentIdx ? 'w-8 bg-purple-400' : 'w-4 bg-slate-800'}`} />
                    ))}
                </div>
            </div>
        </div>
    );
}
