import { BookOpen, FileText, Play } from 'lucide-react';
import { continueReading } from '../lib/dashboard';

const MODE_LABEL = { rsvp: 'Speed Reader', paced: 'Paced', scroll: 'Scroll', natural: 'Natural', skim: 'Skim' };

/**
 * Where to pick up: the last books and part-read passages, with progress and
 * the reading mode you were last using. One click resumes.
 */
export default function ContinueReading({ library, mode, onContinue }) {
    const items = continueReading(library, 3);
    if (items.length === 0) return null;
    const [first, ...rest] = items;

    return (
        <section aria-label="Continue reading" className="grid gap-3 md:grid-cols-3">
            <button
                type="button"
                onClick={() => onContinue(first)}
                className={`${rest.length > 0 ? 'md:col-span-2' : 'md:col-span-3'} text-left bg-slate-900 border border-slate-700 hover:border-purple-500 rounded-3xl p-5 flex items-center gap-4 transition-colors group`}
            >
                <div className="shrink-0 w-12 h-12 rounded-2xl bg-purple-600 text-white grid place-items-center group-hover:scale-105 transition-transform">
                    <Play size={20} className="ml-0.5" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-bold uppercase tracking-widest text-purple-300">
                        Continue reading{MODE_LABEL[mode] ? ` · ${MODE_LABEL[mode]}` : ''}
                    </div>
                    <div className="font-bold text-white truncate mt-0.5">{first.title}</div>
                    <div className="text-xs text-slate-400 truncate">{first.detail}</div>
                    <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden" role="progressbar" aria-valuenow={first.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${first.title} progress`}>
                        <div className="h-full bg-purple-500" style={{ width: `${first.pct}%` }} />
                    </div>
                </div>
                <span className="text-sm font-mono text-slate-400 shrink-0">{first.pct}%</span>
            </button>

            {rest.length > 0 && (
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-3 space-y-1">
                    {rest.map(item => (
                        <button
                            key={item.id} type="button" onClick={() => onContinue(item)}
                            className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-800/70 transition-colors"
                        >
                            {item.kind === 'book' ? <BookOpen size={15} className="text-purple-400 shrink-0" /> : <FileText size={15} className="text-slate-400 shrink-0" />}
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm text-slate-200 truncate">{item.title}</span>
                                <span className="block text-[11px] text-slate-500 truncate">{item.detail}</span>
                            </span>
                            <span className="text-[11px] font-mono text-slate-500 shrink-0">{item.pct}%</span>
                        </button>
                    ))}
                </div>
            )}
        </section>
    );
}
