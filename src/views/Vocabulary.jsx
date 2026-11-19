import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Check, Eye, Plus, Search, Sparkles, Trash2, X, Zap } from 'lucide-react';
import {
    FLASH_START_MS, buildFlashRound, candidateWords, pickWord, createVocabItem, dueItems, isLearned, nextExposure,
    removeVocab, reviewItem, upsertVocab
} from '../lib/vocab';
import usePersistentState from '../lib/usePersistentState';

const TABS = [
    { id: 'review', label: 'Review' },
    { id: 'flash', label: 'Flash drill' },
    { id: 'find', label: 'Find words' },
    { id: 'list', label: 'My words' }
];

const FLASH_ROUNDS = 12;

const defineSpec = (word, context) => ({
    prompt: `Give a short, plain-English definition (under 20 words) of the word "${word}" as it is used in this sentence: "${context}". No example sentence.`,
    schema: { type: 'OBJECT', properties: { definition: { type: 'STRING' } }, required: ['definition'] }
});

/** The context sentence with the word picked out. */
function InContext({ word, context }) {
    if (!context) return null;
    const parts = context.split(new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i'));
    return (
        <p className="text-sm text-slate-300 leading-relaxed">
            {parts.map((part, i) => (part.toLowerCase() === word.toLowerCase()
                ? <mark key={i} className="bg-purple-500/25 text-white rounded px-0.5">{part}</mark>
                : <span key={i}>{part}</span>))}
        </p>
    );
}

function Review({ vocab, setVocab, ai, addNotification }) {
    const due = dueItems(vocab);
    const item = due[0];

    if (vocab.length === 0) {
        return <EmptyState title="No words saved yet" body="Open Find words to pick out the ones that slowed you down in passages you have read." />;
    }
    if (!item) {
        return <EmptyState title="All caught up" body="Nothing due today. Words come back on a widening schedule: 1, 3, 7, 16, 35 and 80 days." />;
    }

    // Keyed by word, so the card starts hidden again for each new word.
    return <ReviewCard key={item.id} item={item} dueCount={due.length} setVocab={setVocab} ai={ai} addNotification={addNotification} />;
}

function ReviewCard({ item, dueCount, setVocab, ai, addNotification }) {
    const [revealed, setRevealed] = useState(false);
    const [defining, setDefining] = useState(false);

    const grade = (g) => {
        setVocab(prev => upsertVocab(prev, reviewItem(item, g)));
        if (g === 'again') addNotification(`"${item.word}" comes back tomorrow.`);
    };

    const define = async () => {
        setDefining(true);
        try {
            const spec = defineSpec(item.word, item.context);
            const reply = await ai.generate(spec);
            if (reply?.definition) setVocab(prev => upsertVocab(prev, { ...item, note: String(reply.definition).trim() }));
        } catch (error) {
            addNotification(error.message || 'Could not get a definition.');
        } finally {
            setDefining(false);
        }
    };

    return (
        <div className="max-w-xl mx-auto">
            <p className="text-xs text-slate-500 text-center mb-3">{dueCount} due today</p>
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 text-center">
                <div className="text-3xl md:text-4xl font-black text-white tracking-tight break-words">{item.word}</div>
                <p className="text-xs text-slate-500 mt-2">Do you know it on sight? Think of the meaning, then reveal.</p>

                {revealed ? (
                    <div className="mt-6 text-left space-y-4 animate-in fade-in">
                        <InContext word={item.word} context={item.context} />
                        {item.source && <p className="text-[11px] text-slate-600">From: {item.source}</p>}
                        <NoteEditor key={item.note} item={item} setVocab={setVocab} />
                        {!item.note && ai?.generate && (
                            <button
                                onClick={define} disabled={defining}
                                className="text-xs font-bold text-purple-400 hover:text-purple-300 flex items-center gap-1.5 disabled:opacity-50"
                            >
                                {defining ? <Activity size={13} className="animate-spin" /> : <Sparkles size={13} />}
                                {defining ? 'Asking…' : `Define with ${ai.label ?? 'AI'}`}
                            </button>
                        )}
                        <div className="grid grid-cols-3 gap-2 pt-2">
                            <button onClick={() => grade('again')} className="py-3 rounded-xl border border-red-900/60 text-red-400 hover:bg-red-950/40 font-bold text-sm">Again</button>
                            <button onClick={() => grade('good')} className="py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-sm">Good</button>
                            <button onClick={() => grade('easy')} className="py-3 rounded-xl border border-emerald-900/60 text-emerald-400 hover:bg-emerald-950/40 font-bold text-sm">Easy</button>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={() => setRevealed(true)}
                        className="mt-6 bg-slate-800 hover:bg-slate-700 text-white font-bold px-6 py-3 rounded-xl inline-flex items-center gap-2"
                    >
                        <Eye size={16} /> Reveal
                    </button>
                )}
            </div>
        </div>
    );
}

function NoteEditor({ item, setVocab }) {
    // Remounted (via key) when the saved note changes, e.g. after an AI definition.
    const [draft, setDraft] = useState(item.note);
    return (
        <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (draft !== item.note) setVocab(prev => upsertVocab(prev, { ...item, note: draft.trim() })); }}
            placeholder="Your definition or a memory hook"
            aria-label={`Note for ${item.word}`}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500"
        />
    );
}

/**
 * Recognition speed: a word flashes, then a mask, then you pick it from four
 * of similar length. The exposure shortens after hits and lengthens after
 * misses, so it settles near how fast you recognise these words.
 */
function FlashDrill({ pool, addNotification }) {
    const [state, setState] = useState('idle'); // idle | showing | masked | answer | done
    const [round, setRound] = useState(null);
    const [exposure, setExposure] = useState(FLASH_START_MS);
    const [results, setResults] = useState([]);
    const [picked, setPicked] = useState(null);
    const timers = useRef([]);

    useEffect(() => () => timers.current.forEach(clearTimeout), []);

    if (pool.length < 4) {
        return <EmptyState title="Need at least four words" body="Save a few words from Find words first, or read more passages so there is something to draw from." />;
    }

    const flash = (ms = exposure) => {
        const target = pickWord(pool);
        setRound(buildFlashRound(target, pool));
        setPicked(null);
        setState('showing');
        timers.current.push(setTimeout(() => setState('masked'), ms));
        timers.current.push(setTimeout(() => setState('answer'), ms + 250));
    };

    const start = () => {
        setResults([]);
        setExposure(FLASH_START_MS);
        flash(FLASH_START_MS);
    };

    const choose = (i) => {
        const correct = i === round.answer;
        setPicked(i);
        const nextMs = nextExposure(exposure, correct);
        const nextResults = [...results, { ms: exposure, correct }];
        setResults(nextResults);
        setExposure(nextMs);
        if (nextResults.length >= FLASH_ROUNDS) {
            const hits = nextResults.filter(r => r.correct).map(r => r.ms);
            const threshold = hits.length ? Math.min(...hits) : null;
            addNotification(threshold ? `Recognised words at ${threshold}ms.` : 'No hits that round. Try again.', threshold ? 'success' : 'info');
            timers.current.push(setTimeout(() => setState('done'), 700));
        } else {
            timers.current.push(setTimeout(() => flash(nextMs), 700));
        }
    };

    const hits = results.filter(r => r.correct);
    const threshold = hits.length ? Math.min(...hits.map(r => r.ms)) : null;

    return (
        <div className="max-w-xl mx-auto">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8">
                <div className="flex justify-between text-xs text-slate-500 mb-4 font-mono">
                    <span>Round {Math.min(results.length + (state === 'done' || state === 'idle' ? 0 : 1), FLASH_ROUNDS)} / {FLASH_ROUNDS}</span>
                    <span>Exposure {exposure}ms</span>
                </div>
                <div className="h-32 grid place-items-center rounded-2xl bg-slate-950 border border-slate-800 mb-5 select-none">
                    {state === 'showing' && <span className="text-3xl md:text-4xl font-bold text-white">{round.target}</span>}
                    {state === 'masked' && <span className="text-3xl md:text-4xl font-bold text-slate-600 tracking-widest">{'#'.repeat(Math.max(6, round.target.length))}</span>}
                    {(state === 'answer' || state === 'idle' || state === 'done') && <span className="text-2xl text-slate-700">+</span>}
                </div>

                {state === 'answer' && (
                    <div className="grid grid-cols-2 gap-2">
                        {round.options.map((option, i) => {
                            const isAnswer = picked !== null && i === round.answer;
                            const isWrong = picked === i && i !== round.answer;
                            return (
                                <button
                                    key={option} onClick={() => picked === null && choose(i)} disabled={picked !== null}
                                    className={`py-3 px-2 rounded-xl border font-bold text-sm break-all transition-colors ${
                                        isAnswer ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                                            : isWrong ? 'border-red-500 bg-red-500/15 text-red-300'
                                                : 'border-slate-700 bg-slate-950 text-slate-200 hover:border-purple-500'}`}
                                >
                                    {option}
                                </button>
                            );
                        })}
                    </div>
                )}

                {(state === 'idle' || state === 'done') && (
                    <div className="text-center">
                        {state === 'done' && (
                            <p className="text-sm text-slate-300 mb-4">
                                {hits.length} of {FLASH_ROUNDS} right. {threshold ? <>Fastest recognition: <span className="font-mono text-emerald-400">{threshold}ms</span>.</> : ''}
                            </p>
                        )}
                        <button onClick={start} className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-6 py-3 rounded-xl inline-flex items-center gap-2">
                            <Zap size={16} /> {state === 'done' ? 'Go again' : 'Start'}
                        </button>
                        <p className="text-xs text-slate-500 mt-3">Keep your eyes on the + . A word flashes, then pick which one it was.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

function FindWords({ library, vocab, setVocab, dismissed, setDismissed, addNotification }) {
    const exclude = useMemo(() => new Set([...vocab.map(v => v.word), ...dismissed]), [vocab, dismissed]);
    const candidates = useMemo(() => candidateWords(library, exclude), [library, exclude]);
    const [filter, setFilter] = useState('');
    const shown = candidates.filter(c => c.word.includes(filter.trim().toLowerCase()));

    if (library.length === 0) {
        return <EmptyState title="Read something first" body="Candidates come from passages in your library, so the words are ones you actually ran into." />;
    }

    const save = (c) => {
        setVocab(prev => upsertVocab(prev, createVocabItem({ word: c.word, context: c.context, source: c.source })));
        addNotification(`Saved "${c.word}".`, 'success');
    };

    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-400 max-w-2xl">
                Long, uncommon words from passages you have read, rarest first. Save the ones that made you slow down or re-read;
                skip the ones you know. Unfamiliar words cost extra fixations, so these are direct speed gains.
            </p>
            <div className="relative max-w-sm">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                    value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter"
                    aria-label="Filter candidate words"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500"
                />
            </div>
            {shown.length === 0 ? (
                <EmptyState title="Nothing new" body="Every candidate has been saved or skipped. New passages bring new words." />
            ) : (
                <div className="grid md:grid-cols-2 gap-3">
                    {shown.map(c => (
                        <div key={c.word} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <div className="text-lg font-bold text-white">{c.word}</div>
                                    <div className="text-[11px] text-slate-500">{c.source}{c.count > 1 ? ` · seen ${c.count}×` : ''}</div>
                                </div>
                                <div className="flex gap-1.5 shrink-0">
                                    <button onClick={() => setDismissed(prev => [...prev, c.word].slice(-2000))} aria-label={`Skip ${c.word}`} className="p-2 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800">
                                        <X size={16} />
                                    </button>
                                    <button onClick={() => save(c)} aria-label={`Save ${c.word}`} className="p-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white">
                                        <Plus size={16} />
                                    </button>
                                </div>
                            </div>
                            <InContext word={c.word} context={c.context} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function WordList({ vocab, setVocab }) {
    if (vocab.length === 0) return <EmptyState title="No words yet" body="Saved words appear here with their next review date." />;
    return (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl divide-y divide-slate-800">
            {vocab.map(item => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="font-bold text-white">{item.word}</span>
                            {isLearned(item) && <Check size={14} className="text-emerald-400" aria-label="Learned" />}
                        </div>
                        <div className="text-xs text-slate-500 truncate">{item.note || item.context}</div>
                    </div>
                    <span className="text-xs text-slate-500 font-mono shrink-0">next {item.due}</span>
                    <button onClick={() => setVocab(prev => removeVocab(prev, item.id))} aria-label={`Delete ${item.word}`} className="p-2 text-slate-600 hover:text-red-400">
                        <Trash2 size={15} />
                    </button>
                </div>
            ))}
        </div>
    );
}

function EmptyState({ title, body }) {
    return (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center max-w-xl mx-auto">
            <div className="font-bold text-white">{title}</div>
            <p className="text-sm text-slate-400 mt-1.5">{body}</p>
        </div>
    );
}

export default function Vocabulary({ vocab, setVocab, library, ai, addNotification }) {
    const [tab, setTab] = useState(() => (dueItems(vocab).length > 0 ? 'review' : vocab.length === 0 ? 'find' : 'review'));
    const [dismissed, setDismissed] = usePersistentState('speedReadVocabDismissed', (raw) => (Array.isArray(raw) ? raw.filter(w => typeof w === 'string') : []), []);
    const due = dueItems(vocab).length;
    const learned = vocab.filter(isLearned).length;

    // The flash drill draws from saved words first, topped up with candidates
    // so it works before you have saved many.
    const pool = useMemo(() => {
        const saved = vocab.map(v => v.word);
        if (saved.length >= 8) return saved;
        const extra = candidateWords(library, new Set(saved), 20).map(c => c.word);
        return [...saved, ...extra];
    }, [vocab, library]);

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">Vocabulary</h1>
                    <p className="text-slate-400 mt-1 text-sm">Words you stumbled on, until you know them on sight.</p>
                </div>
                <div className="flex gap-4 text-sm">
                    <span className="text-slate-400"><strong className="text-white tabular-nums">{vocab.length}</strong> saved</span>
                    <span className="text-slate-400"><strong className="text-purple-400 tabular-nums">{due}</strong> due</span>
                    <span className="text-slate-400"><strong className="text-emerald-400 tabular-nums">{learned}</strong> learned</span>
                </div>
            </div>

            <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-2xl p-1 w-full sm:w-fit overflow-x-auto" role="tablist">
                {TABS.map(t => (
                    <button
                        key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                        className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-colors ${tab === t.id ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                        {t.label}{t.id === 'review' && due > 0 ? ` (${due})` : ''}
                    </button>
                ))}
            </div>

            {tab === 'review' && <Review vocab={vocab} setVocab={setVocab} ai={ai} addNotification={addNotification} />}
            {tab === 'flash' && <FlashDrill pool={pool} addNotification={addNotification} />}
            {tab === 'find' && <FindWords library={library} vocab={vocab} setVocab={setVocab} dismissed={dismissed} setDismissed={setDismissed} addNotification={addNotification} />}
            {tab === 'list' && <WordList vocab={vocab} setVocab={setVocab} />}
        </div>
    );
}
