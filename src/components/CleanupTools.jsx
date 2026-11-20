import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Activity, BookMarked, ChevronRight, Undo2, Wrench } from 'lucide-react';
import { applyRepairs, findNotes, removeNotes, selectBlocksForRepair, undoRepair } from '../lib/importText';
import { repairDocSpec } from '../lib/ai';
import ManualAiPanel from './ManualAiPanel';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Two clean-up tools shared by Upload and the Documents clean dialog:
 *
 *   - Notes & references: footnote numbers glued to words, footnote
 *     paragraphs and a trailing reference list, removed in one click. The
 *     removed paragraphs join the cut list, so each can be restored.
 *   - AI Repair: sends only paragraphs that look damaged (split mid-sentence,
 *     garbled by OCR) and applies fixes that keep the original letters; every
 *     change is listed with its own undo.
 *
 * `setText` takes an updater; `onCuts` receives restorable cut items;
 * `onBeforeChange` lets the parent keep its pre-clean copy for "Undo clean".
 */
export default function CleanupTools({ text, setText, rank, ai, onCuts, onBeforeChange, addNotification, disabled = false }) {
    const useApi = Boolean(ai?.generate);
    const [repairs, setRepairs] = useState([]);
    const [repairing, setRepairing] = useState(false);
    const [manualOpen, setManualOpen] = useState(false);
    // The latest text, so a reply that arrives after the text changed is not
    // applied over the newer version.
    const textRef = useRef(text);
    useLayoutEffect(() => { textRef.current = text; });

    const notes = useMemo(() => (text.trim() ? findNotes(text, rank) : null), [text, rank]);
    const refEntries = notes?.references ? notes.references.end - notes.references.heading - 1 : 0;
    const hasNotes = notes && (notes.markers > 0 || notes.blocks.length > 0 || notes.references);

    const repairBlocks = useMemo(() => (text.trim() ? selectBlocksForRepair(text) : []), [text]);
    const repairSpec = useMemo(() => (repairBlocks.length ? repairDocSpec({ blocks: repairBlocks }) : null), [repairBlocks]);

    const handleRemoveNotes = () => {
        if (!notes) return;
        onBeforeChange?.();
        const out = removeNotes(text, notes, rank);
        setText(() => out.text);
        if (out.cutItems.length) onCuts?.(out.cutItems);
        const parts = [];
        if (out.markers) parts.push(plural(out.markers, 'footnote number'));
        if (notes.blocks.length) parts.push(plural(notes.blocks.length, 'footnote'));
        if (notes.references) parts.push(`a reference list (${refEntries} ${refEntries === 1 ? 'entry' : 'entries'})`);
        addNotification?.(`Removed ${parts.join(', ')}. Removed paragraphs can be restored below.`, 'success');
    };

    const applyReply = (reply, shown = repairBlocks, sent = text) => {
        if (textRef.current !== sent) {
            addNotification?.('The text changed while the AI was working, so its repairs were not applied. Run AI Repair again.');
            return;
        }
        const { text: next, changes, skipped } = applyRepairs(sent, reply?.fixes, shown);
        setManualOpen(false);
        if (skipped.length) addNotification?.(`Ignored ${plural(skipped.length, 'suggested fix')} that changed the wording or touched other text.`);
        if (!changes.length) { addNotification?.('AI found nothing it could safely repair.'); return; }
        onBeforeChange?.();
        setText(() => next);
        setRepairs(prev => [...changes, ...prev]);
        addNotification?.(`Repaired ${plural(changes.length, 'paragraph')}. Review or undo each below.`, 'success');
    };

    const handleRepair = async () => {
        if (!repairSpec) return;
        if (!useApi) { setManualOpen(o => !o); return; }
        setRepairing(true);
        try {
            const sent = text;
            const shown = repairBlocks;
            applyReply(await ai.generate({ prompt: repairSpec.prompt, schema: repairSpec.schema }), shown, sent);
        } catch (error) {
            addNotification?.(error.message || 'AI repair failed.');
        } finally {
            setRepairing(false);
        }
    };

    const undo = (change) => {
        const back = undoRepair(text, change);
        if (back === text) {
            addNotification?.('That paragraph has changed since the repair (cleaned or edited), so it cannot be undone automatically.');
            return;
        }
        setText(() => back);
        setRepairs(prev => prev.filter(c => c.id !== change.id));
    };

    if (!text.trim()) return null;

    return (
        <div className="space-y-2">
            {hasNotes && (
                <div className="flex items-center justify-between gap-2 flex-wrap bg-amber-950/20 border border-amber-800/40 rounded-xl px-3.5 py-2 text-xs text-amber-200/90">
                    <span className="flex items-center gap-1.5">
                        <BookMarked size={13} className="shrink-0" />
                        Found {[
                            notes.markers > 0 && plural(notes.markers, 'footnote number'),
                            notes.blocks.length > 0 && plural(notes.blocks.length, 'footnote'),
                            notes.references && `a reference list (${refEntries} ${refEntries === 1 ? 'entry' : 'entries'})`
                        ].filter(Boolean).join(', ')}.
                    </span>
                    <button
                        type="button" onClick={handleRemoveNotes} disabled={disabled || repairing}
                        className="font-bold text-amber-300 hover:text-amber-100 disabled:opacity-40"
                    >
                        Remove them
                    </button>
                </div>
            )}

            {repairBlocks.length > 0 && (
                <div className="flex items-center justify-between gap-2 flex-wrap bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-400">
                    <span>
                        {plural(repairBlocks.length, 'paragraph')} {repairBlocks.length === 1 ? 'looks' : 'look'} damaged by extraction (split mid-sentence or garbled).
                    </span>
                    <button
                        type="button" onClick={handleRepair} disabled={disabled || repairing}
                        title={ai?.note}
                        className="inline-flex items-center gap-1.5 font-bold text-purple-300 hover:text-white disabled:opacity-40"
                    >
                        {repairing ? <Activity className="animate-spin" size={12} /> : <Wrench size={12} />}
                        {repairing ? `Repairing on ${ai?.label}…` : 'AI Repair'}
                    </button>
                </div>
            )}

            {manualOpen && !useApi && repairSpec && (
                <ManualAiPanel spec={repairSpec} addNotification={addNotification} onResult={(reply) => applyReply(reply)} />
            )}

            {repairs.length > 0 && (
                <details className="group bg-slate-950 border border-slate-800 rounded-xl" open>
                    <summary className="cursor-pointer select-none px-4 py-2.5 flex items-center gap-1.5 text-xs font-bold text-slate-300 hover:text-white">
                        <ChevronRight size={14} className="group-open:rotate-90 transition-transform" />
                        AI repairs ({repairs.length})
                    </summary>
                    <ul className="px-4 pb-3 space-y-2 max-h-64 overflow-y-auto">
                        {repairs.map(c => (
                            <li key={c.id} className="text-xs border-t border-slate-800 pt-2">
                                <div className="flex items-start justify-between gap-2">
                                    <span className="text-slate-500">{c.merge ? 'Joined two paragraphs' : 'Fixed'}</span>
                                    <button type="button" onClick={() => undo(c)} className="inline-flex items-center gap-1 text-purple-400 hover:text-purple-300 font-bold shrink-0">
                                        <Undo2 size={11} /> Undo
                                    </button>
                                </div>
                                <p className="text-red-300/70 line-through decoration-red-400/40 mt-1 break-words">{c.before.join(' ¶ ').slice(0, 400)}</p>
                                <p className="text-emerald-300/90 mt-0.5 break-words">{c.after.slice(0, 400)}</p>
                            </li>
                        ))}
                    </ul>
                </details>
            )}
        </div>
    );
}
