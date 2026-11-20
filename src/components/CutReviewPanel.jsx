import { ChevronRight, RotateCcw } from 'lucide-react';

/**
 * Collapsible diff list of lines/paragraphs cut during document cleanup,
 * letting the user inspect reasons and restore anything important.
 */
export default function CutReviewPanel({ cuts, onRestore, onRestoreAll, defaultOpen = false }) {
    if (!cuts || cuts.length === 0) return null;

    return (
        <details className="group bg-slate-950 border border-red-900/40 rounded-xl" open={defaultOpen}>
            <summary className="cursor-pointer select-none px-4 py-2.5 flex items-center justify-between text-xs font-bold text-slate-300 hover:text-white">
                <span className="flex items-center gap-1.5">
                    <ChevronRight size={14} className="group-open:rotate-90 transition-transform" />
                    Review cuts ({cuts.length})
                </span>
                <span className="text-slate-500 font-normal">Restore anything important</span>
            </summary>
            <div className="px-4 pb-3 pt-1 space-y-2 max-h-60 overflow-y-auto">
                <div className="flex justify-end">
                    <button
                        type="button"
                        onClick={onRestoreAll}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-white"
                    >
                        <RotateCcw size={11} /> Restore all
                    </button>
                </div>
                {cuts.map(item => (
                    <div key={item.id} className="flex items-start justify-between gap-3 bg-red-950/20 border border-red-900/40 rounded-lg px-3 py-2 text-xs">
                        <div className="min-w-0 flex-1">
                            <span className="inline-block text-[10px] font-bold uppercase tracking-wider bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded mr-2">
                                {item.reason}
                            </span>
                            {Number.isInteger(item.index) && (
                                <span className="text-[10px] font-mono text-slate-500 mr-2">#{item.index + 1}</span>
                            )}
                            <span className="font-mono text-red-300/90 break-words">- {item.text}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => onRestore(item)}
                            className="shrink-0 text-[11px] font-bold text-purple-400 hover:text-purple-300 px-2 py-0.5 rounded border border-purple-800/60"
                        >
                            Restore
                        </button>
                    </div>
                ))}
            </div>
        </details>
    );
}
