import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Package, Plus, Trash2, X } from 'lucide-react';
import { buildDrillPack } from '../../lib/drillPack';
import { isBook } from '../../lib/book';
import { loadFrequencyRank } from '../../lib/vocab';

/** Every book, chapter and passage in the library that has text, as pack sources. */
function packSources(library) {
    const out = [];
    for (const item of Array.isArray(library) ? library : []) {
        if (isBook(item)) {
            out.push({ key: `${item.id}:all`, label: `${item.title} — whole book`, title: item.title, text: item.chapters.map(c => c.text).join('\n\n') });
            item.chapters.forEach((c, i) => out.push({
                key: `${item.id}:${i}`, label: `${item.title} — ${i + 1}. ${c.title}`, title: item.title, chapter: c.title, text: c.text
            }));
        } else if (typeof item?.text === 'string' && item.text.trim()) {
            out.push({ key: item.id, label: item.title || 'Untitled passage', title: item.title, text: item.text });
        }
    }
    return out;
}

function MakePackDialog({ library, onSave, onClose, addNotification }) {
    const sources = useMemo(() => packSources(library), [library]);
    const [key, setKey] = useState(sources[0]?.key ?? '');
    const source = sources.find(s => s.key === key);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const make = async () => {
        if (!source) return;
        setBusy(true);
        try {
            const rank = await loadFrequencyRank().catch(() => null);
            const pack = buildDrillPack({
                title: name.trim() || (source.chapter ? `${source.title}: ${source.chapter}` : source.title),
                text: source.text, source: { title: source.title, chapter: source.chapter }, rank
            });
            onSave(pack);
            addNotification?.(`Made "${pack.title}": ${pack.terms.length} key terms, ${pack.passages.length} scanning passages.`, 'success');
            onClose();
        } catch (error) {
            addNotification?.(error.message || 'Could not make a pack from that.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] grid place-items-center p-4">
            <button aria-label="Close" className="absolute inset-0 bg-black/60" onClick={onClose} />
            <div role="dialog" aria-label="Make a drill pack" className="relative w-full max-w-lg bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl space-y-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-bold text-white flex items-center gap-2"><Package size={18} className="text-purple-400" /> Make a drill pack</h2>
                        <p className="text-xs text-slate-400 mt-1">
                            Chunk Perception will flash real phrases from it, and Target Scanning will hunt its key terms in its own paragraphs.
                        </p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 text-slate-400 hover:text-white"><X size={18} /></button>
                </div>

                {sources.length === 0 ? (
                    <p className="text-sm text-slate-400">Your library is empty. Import a document or save a passage first, then make a pack from it.</p>
                ) : (
                    <>
                        <label className="block text-sm text-slate-300">
                            From
                            <select
                                value={key} onChange={(e) => setKey(e.target.value)}
                                className="mt-1.5 w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white"
                            >
                                {sources.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                            </select>
                        </label>
                        <label className="block text-sm text-slate-300">
                            Name <span className="text-slate-500">(optional)</span>
                            <input
                                value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
                                placeholder={source ? (source.chapter ? `${source.title}: ${source.chapter}` : source.title) : ''}
                                className="mt-1.5 w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white"
                            />
                        </label>
                        <div className="flex justify-end gap-2">
                            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white">Cancel</button>
                            <button type="button" onClick={make} disabled={busy || !source} className="px-4 py-2 rounded-xl text-sm font-bold bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white">
                                {busy ? 'Making…' : 'Make pack'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

/**
 * Chooses what the word drills practise on: the built-in word list, or a pack
 * made from one of your documents.
 */
export default function DrillPackPanel({ packs, activePackId, onSelect, onSave, onDelete, library, addNotification }) {
    const [making, setMaking] = useState(false);
    const chip = (active) => `px-3 py-2 rounded-xl border text-left text-sm transition-colors ${active
        ? 'border-purple-500 bg-purple-500/15 text-white'
        : 'border-slate-700 text-slate-300 hover:border-slate-500'}`;

    return (
        <section className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-3" aria-label="Practice material">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-lg font-bold text-white">Practice material</h2>
                    <p className="text-xs text-slate-400">For Chunk Perception and Target Scanning. Schulte and Peripheral use numbers and letters, so they work the same either way.</p>
                </div>
                <button type="button" onClick={() => setMaking(true)} className="inline-flex items-center gap-1.5 text-sm font-bold bg-purple-600 hover:bg-purple-500 text-white px-3 py-2 rounded-xl">
                    <Plus size={15} /> Make a pack
                </button>
            </div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Practice material">
                <button type="button" role="radio" aria-checked={!activePackId} onClick={() => onSelect(null)} className={chip(!activePackId)}>
                    <span className="font-bold block">Built-in words</span>
                    <span className="text-[11px] text-slate-400">Everyday words, the same every time</span>
                </button>
                {packs.map(p => (
                    <div key={p.id} className="relative group">
                        <button type="button" role="radio" aria-checked={activePackId === p.id} onClick={() => onSelect(p.id)} className={`${chip(activePackId === p.id)} pr-9`}>
                            <span className="font-bold flex items-center gap-1.5"><BookOpen size={13} className="text-purple-400" />{p.title}</span>
                            <span className="text-[11px] text-slate-400">{p.terms.length} terms · {p.passages.length} passages · {p.createdAt}</span>
                        </button>
                        <button
                            type="button" onClick={() => onDelete(p.id)} aria-label={`Delete pack ${p.title}`}
                            className="absolute top-2 right-2 p-1 text-slate-600 hover:text-red-400"
                        >
                            <Trash2 size={13} />
                        </button>
                    </div>
                ))}
            </div>
            {making && <MakePackDialog library={library} onSave={(pack) => { onSave(pack); onSelect(pack.id); }} onClose={() => setMaking(false)} addNotification={addNotification} />}
        </section>
    );
}
