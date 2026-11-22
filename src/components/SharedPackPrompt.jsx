import { Package } from 'lucide-react';

/**
 * Shown when the app is opened from a shared drill-pack link: what the pack
 * holds and where it came from, and nothing is added until you say so.
 */
export default function SharedPackPrompt({ pack, onAdd, onDismiss }) {
    const phraseCount = Object.values(pack.phrases).reduce((n, l) => n + l.length, 0);
    return (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4">
            <button aria-label="Dismiss" className="absolute inset-0 bg-black/60" onClick={onDismiss} />
            <div role="dialog" aria-label="Shared drill pack" className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl space-y-4">
                <h2 className="text-lg font-bold text-white flex items-center gap-2"><Package size={18} className="text-purple-400" /> Someone shared a drill pack</h2>
                <div className="text-sm text-slate-300 space-y-1">
                    <p className="font-bold text-white">{pack.title}</p>
                    {pack.source.title && <p className="text-slate-400">From {pack.source.title}{pack.source.chapter ? ` · ${pack.source.chapter}` : ''}</p>}
                    <p className="text-xs text-slate-500">
                        {phraseCount} phrases · {pack.terms.length} key terms · {pack.passages.length} passages{pack.meaning.length ? ` · ${pack.meaning.length} AI drill items` : ''}
                    </p>
                </div>
                <p className="text-xs text-slate-400">Adding it puts it in Neuro-Drills. It holds practice text only; nothing of yours is sent anywhere.</p>
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onDismiss} className="px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white">No thanks</button>
                    <button type="button" onClick={onAdd} className="px-4 py-2 rounded-xl text-sm font-bold bg-purple-600 hover:bg-purple-500 text-white">Add to my drills</button>
                </div>
            </div>
        </div>
    );
}
