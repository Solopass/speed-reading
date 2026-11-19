import { CheckCircle2, Info, X } from 'lucide-react';

/**
 * Toast stack. Announced through a polite live region so screen readers hear
 * session results, and each toast can be dismissed instead of waiting it out.
 * Sits above the phone tab bar.
 */
export default function Toasts({ items, onDismiss }) {
    return (
        <div
            className="fixed z-[60] right-4 left-4 md:left-auto md:right-6 bottom-20 md:bottom-6 flex flex-col items-stretch md:items-end gap-2 pointer-events-none"
            aria-live="polite" role="status"
        >
            {items.map(note => (
                <div
                    key={note.id}
                    className="pointer-events-auto md:max-w-sm bg-slate-900 border border-slate-700 text-slate-100 pl-4 pr-2 py-3 rounded-2xl shadow-xl shadow-black/30 flex items-start gap-3 animate-in slide-in-from-bottom-4 md:slide-in-from-right-8"
                >
                    {note.tone === 'success'
                        ? <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
                        : <Info size={18} className="text-purple-400 shrink-0 mt-0.5" />}
                    <span className="text-sm font-medium flex-1">{note.msg}</span>
                    <button onClick={() => onDismiss(note.id)} aria-label="Dismiss" className="text-slate-500 hover:text-slate-200 p-1 -my-1">
                        <X size={15} />
                    </button>
                </div>
            ))}
        </div>
    );
}
