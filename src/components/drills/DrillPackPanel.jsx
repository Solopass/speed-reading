import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BookOpen, Download, Link2, Package, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { buildDrillPack, newPackId } from '../../lib/drillPack';
import { isBook } from '../../lib/book';
import { loadFrequencyRank } from '../../lib/vocab';
import { meaningDrillSpec, validateMeaningItems } from '../../lib/aiDrills';
import { MAX_LINK_CHARS, downloadPackFile, packFromFileText, packToLink } from '../../lib/packShare';

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

/** Best score on each drill for runs made with this pack. */
function packBests(drills, packId) {
    const runs = (drills ?? []).filter(d => d.packId === packId);
    const best = (kind, higher) => {
        const ms = runs.filter(r => r.kind === kind).map(r => r.metric);
        return ms.length ? (higher ? Math.max(...ms) : Math.min(...ms)) : null;
    };
    return { chunk: best('chunk', true), scanning: best('scanning', false), meaning: best('meaning', false), runs: runs.length };
}

function PackCard({ pack, active, onSelect, onSave, onDelete, drills, ai, addNotification }) {
    const [busy, setBusy] = useState(null);   // 'ai' | 'link' | null
    const [shownLink, setShownLink] = useState(null);
    const bests = packBests(drills, pack.id);
    const phraseCount = Object.values(pack.phrases).reduce((n, l) => n + l.length, 0);
    const canAi = Boolean(ai?.generate) && pack.passages.length > 0;

    const addAiDrills = async () => {
        setBusy('ai');
        try {
            const spec = meaningDrillSpec({ title: pack.title, passages: pack.passages, terms: pack.terms, round: Math.floor(pack.meaning.length / 6) });
            const reply = await ai.generate({ prompt: spec.prompt, schema: spec.schema });
            const items = validateMeaningItems(reply?.items, pack.passages.join('\n\n'), pack.terms);
            if (items.length < 3) {
                addNotification?.('The AI did not return enough usable items (each phrase must come from the text). Try again.');
                return;
            }
            const meaning = [...pack.meaning, ...items].slice(0, 30);
            // Only updates the pack if it still exists (it may have been deleted meanwhile).
            onSave({ ...pack, meaning }, { updateOnly: true });
            addNotification?.(`Added ${items.length} Meaning at a Glance items to "${pack.title}".`, 'success');
        } catch (error) {
            addNotification?.(error.message || 'AI drill generation failed.');
        } finally {
            setBusy(null);
        }
    };

    const copyLink = async () => {
        setBusy('link');
        try {
            const link = await packToLink(pack);
            if (link.length > MAX_LINK_CHARS) {
                downloadPackFile(pack);
                addNotification?.('This pack is too big for a link, so it was saved as a file to send instead.');
                return;
            }
            try {
                await navigator.clipboard.writeText(link);
                setShownLink(null);
                addNotification?.('Share link copied. It opens the pack in the online app.', 'success');
            } catch {
                // No clipboard here (or the browser refused): show it to copy by hand.
                setShownLink(link);
            }
        } catch (error) {
            addNotification?.(error.message || 'Could not make a share link.');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className={`rounded-2xl border p-3 space-y-2 ${active ? 'border-purple-500 bg-purple-500/10' : 'border-slate-700'}`}>
            <button type="button" role="radio" aria-checked={active} onClick={() => onSelect(pack.id)} className="w-full text-left">
                <span className="font-bold text-white flex items-center gap-1.5"><BookOpen size={14} className="text-purple-400 shrink-0" /><span className="truncate">{pack.title}</span></span>
                <span className="block text-[11px] text-slate-400 mt-0.5">
                    {phraseCount} phrases · {pack.terms.length} terms · {pack.passages.length} passages{pack.meaning.length ? ` · ${pack.meaning.length} AI items` : ''} · {pack.createdAt}
                </span>
                {bests.runs > 0 && (
                    <span className="block text-[11px] text-emerald-300/90 mt-0.5">
                        Best: {[
                            bests.chunk !== null && `${bests.chunk} words`,
                            bests.scanning !== null && `${bests.scanning}s scan`,
                            bests.meaning !== null && `${bests.meaning} ms/word`
                        ].filter(Boolean).join(' · ')}
                    </span>
                )}
            </button>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
                {canAi && (
                    <button type="button" onClick={addAiDrills} disabled={busy !== null} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-violet-700/60 text-violet-300 hover:text-white disabled:opacity-40">
                        {busy === 'ai' ? <Activity size={11} className="animate-spin" /> : <Sparkles size={11} />}
                        {busy === 'ai' ? `Writing on ${ai.label}…` : pack.meaning.length ? 'More AI drills' : 'Add AI drills'}
                    </button>
                )}
                <button type="button" onClick={copyLink} disabled={busy !== null} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-700 text-slate-300 hover:text-white disabled:opacity-40">
                    <Link2 size={11} /> Copy share link
                </button>
                <button type="button" onClick={() => downloadPackFile(pack)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-700 text-slate-300 hover:text-white">
                    <Download size={11} /> File
                </button>
                {shownLink && (
                    <input
                        readOnly value={shownLink} aria-label="Share link" onFocus={(e) => e.target.select()}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-slate-300 font-mono"
                    />
                )}
                <button type="button" onClick={() => onDelete(pack.id)} aria-label={`Delete pack ${pack.title}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-slate-500 hover:text-red-400 ml-auto">
                    <Trash2 size={11} /> Delete
                </button>
            </div>
        </div>
    );
}

/**
 * Chooses what the word drills practise on: the built-in word list, or a pack
 * made from one of your documents. Packs can get AI-written drills, and can be
 * shared as a link or a file.
 */
export default function DrillPackPanel({ packs, activePackId, onSelect, onSave, onDelete, library, drills = [], ai = null, addNotification }) {
    const [making, setMaking] = useState(false);
    const fileRef = useRef(null);

    const importFile = (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const pack = packFromFileText(String(reader.result));
                // A pack already here keeps its copy; an import never overwrites it silently.
                const exists = packs.some(p => p.id === pack.id);
                const saved = exists ? { ...pack, id: newPackId() } : pack;
                onSave(saved);
                onSelect(saved.id);
                addNotification?.(`Imported "${saved.title}".`, 'success');
            } catch (error) {
                addNotification?.(error.message);
            }
        };
        reader.readAsText(file);
    };

    return (
        <section className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-3" aria-label="Practice material">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-lg font-bold text-white">Practice material</h2>
                    <p className="text-xs text-slate-400">For Chunk Perception, Target Scanning and Meaning at a Glance. Schulte and Peripheral use numbers and letters, so they work the same either way.</p>
                </div>
                <div className="flex gap-2">
                    <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 text-sm font-bold border border-slate-700 hover:border-purple-500 text-slate-200 px-3 py-2 rounded-xl">
                        <Upload size={15} /> Import pack
                    </button>
                    <button type="button" onClick={() => setMaking(true)} className="inline-flex items-center gap-1.5 text-sm font-bold bg-purple-600 hover:bg-purple-500 text-white px-3 py-2 rounded-xl">
                        <Plus size={15} /> Make a pack
                    </button>
                    <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" aria-label="Choose a drill pack file"
                        onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
                </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Practice material">
                <button type="button" role="radio" aria-checked={!activePackId} onClick={() => onSelect(null)}
                    className={`rounded-2xl border p-3 text-left ${!activePackId ? 'border-purple-500 bg-purple-500/10' : 'border-slate-700 hover:border-slate-500'}`}>
                    <span className="font-bold text-white block">Built-in words</span>
                    <span className="text-[11px] text-slate-400">Everyday words, the same every time</span>
                </button>
                {packs.map(p => (
                    <PackCard key={p.id} pack={p} active={activePackId === p.id} onSelect={onSelect} onSave={onSave} onDelete={onDelete} drills={drills} ai={ai} addNotification={addNotification} />
                ))}
            </div>
            {packs.length > 0 && (
                <p className="text-[11px] text-slate-500">
                    A shared pack contains its phrases, key terms, AI items and up to 8 paragraphs of the source text, nothing else. Only share text you are happy to pass on.
                </p>
            )}
            {making && <MakePackDialog library={library} onSave={(pack) => { onSave(pack); onSelect(pack.id); }} onClose={() => setMaking(false)} addNotification={addNotification} />}
        </section>
    );
}
