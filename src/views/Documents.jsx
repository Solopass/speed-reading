import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Activity, Bookmark, BookOpen, Brain, ChevronRight, Download, FileText, Play, Search, Sparkles, Upload, X
} from 'lucide-react';
import { cleanDocSpec, dropGuessableQuestions, questionsForTextSpec, verifySpec } from '../lib/ai';
import { normalizeQuestions } from '../lib/quiz';
import CleanupTools from '../components/CleanupTools';
import { loadFrequencyRank } from '../lib/vocab';
import { applyParagraphCuts, chunkBlocksForAiClean, restoreCutItem, selectBlocksForAiClean, validateAiCuts, aiCutIndex } from '../lib/importText';
import { isPartiallyRead, resumePoint } from '../lib/library';
import { isBook } from '../lib/book';
import BookShelf from '../components/BookShelf';
import FreeBooks from '../components/FreeBooks';
import CutReviewPanel from '../components/CutReviewPanel';
import ManualAiPanel from '../components/ManualAiPanel';

const minutes = (words, wpm) => Math.max(1, Math.round(words / Math.max(100, wpm)));

function exportNotesMarkdown(books, passages) {
    const sections = [];
    for (const b of books) {
        if (!b.bookmarks?.length) continue;
        const lines = [`## ${b.title}`];
        for (const bm of b.bookmarks) {
            const chTitle = b.chapters[bm.chapter]?.title ?? `Chapter ${(bm.chapter ?? 0) + 1}`;
            lines.push(`- **${chTitle}** (${bm.createdAt}): "${bm.snippet}"${bm.note ? `\n  - Note: ${bm.note}` : ''}`);
        }
        sections.push(lines.join('\n'));
    }
    for (const p of passages) {
        if (!p.bookmarks?.length) continue;
        const lines = [`## ${p.title}`];
        for (const bm of p.bookmarks) {
            lines.push(`- (${bm.createdAt}): "${bm.snippet}"${bm.note ? `\n  - Note: ${bm.note}` : ''}`);
        }
        sections.push(lines.join('\n'));
    }
    const blob = new Blob([`# Reading Notes & Bookmarks\n\n${sections.join('\n\n')}\n`], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'reading-notes.md';
    a.click();
    URL.revokeObjectURL(url);
}

function AiCleanModal({ target, ai, onSave, onClose, addNotification }) {
    const useApi = Boolean(ai?.generate);
    const [draftText, setDraftText] = useState(target.text ?? '');
    const [cuts, setCuts] = useState([]);
    const [cleaning, setCleaning] = useState(false);
    const [progress, setProgress] = useState('');
    const closedRef = useRef(false);
    const [rank, setRank] = useState(null);
    useEffect(() => { loadFrequencyRank().then(setRank).catch(() => {}); }, []);

    useEffect(() => {
        closedRef.current = false;
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => {
            closedRef.current = true;
            window.removeEventListener('keydown', onKey);
        };
    }, [onClose]);

    const blocks = useMemo(() => (draftText.trim() ? selectBlocksForAiClean(draftText) : []), [draftText]);
    const chunks = useMemo(() => (draftText.trim() ? chunkBlocksForAiClean(draftText) : []), [draftText]);
    const spec = useMemo(() => (blocks.length > 0 ? cleanDocSpec({ blocks }) : null), [blocks]);

    const applyReply = (reply, shownBlocks = blocks) => {
        const { accepted: list, skipped } = validateAiCuts(reply?.cuts, shownBlocks, draftText);
        if (skipped.length > 0) {
            addNotification(`Kept ${skipped.length} block${skipped.length === 1 ? '' : 's'} the AI wanted to cut (headings, prose or blocks it was not shown).`);
        }
        if (list.length === 0) {
            addNotification('AI found no extra clutter to cut.');
            return;
        }
        const { text, cutItems } = applyParagraphCuts(draftText, list);
        if (cutItems.length === 0) {
            addNotification('AI found no matching blocks to cut.');
            return;
        }
        setDraftText(text);
        setCuts(prev => [...cutItems, ...prev]);
        addNotification(`AI cut ${cutItems.length} clutter block${cutItems.length === 1 ? '' : 's'}. Review below.`, 'success');
    };

    const runAiClean = async (deep = false) => {
        if (!spec || !useApi) return;
        setCleaning(true);
        setProgress('');
        try {
            if (!deep || chunks.length <= 1) {
                const reply = await ai.generate({ prompt: spec.prompt, schema: spec.schema });
                applyReply(reply);
            } else {
                const allCuts = [];
                for (let i = 0; i < chunks.length; i++) {
                    if (closedRef.current) return;
                    setProgress(`${i + 1}/${chunks.length}`);
                    const chunkSpec = cleanDocSpec({ blocks: chunks[i] });
                    const reply = await ai.generate({ prompt: chunkSpec.prompt, schema: chunkSpec.schema });
                    if (closedRef.current) return;
                    const own = new Set(chunks[i].map(b => b.index));
                    if (Array.isArray(reply?.cuts)) allCuts.push(...reply.cuts.filter(c => own.has(aiCutIndex(c))));
                }
                if (!closedRef.current) applyReply({ cuts: allCuts }, chunks.flat());
            }
        } catch (error) {
            addNotification(error.message || 'AI cleanup failed.');
        } finally {
            setCleaning(false);
            setProgress('');
        }
    };

    const restoreOne = (item) => {
        setDraftText(prev => restoreCutItem(prev, item));
        setCuts(prev => prev.filter(c => c.id !== item.id));
    };

    const restoreAll = () => {
        setDraftText(target.text ?? '');
        setCuts([]);
    };

    const changed = draftText !== (target.text ?? '');

    return (
        <div className="fixed inset-0 z-[60] grid place-items-center p-4">
            <button aria-label="Close AI clean dialog" className="absolute inset-0 bg-black/60" onClick={onClose} />
            <div role="dialog" aria-label={`Clean ${target.title}`} className="relative w-full max-w-2xl max-h-[85vh] bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl flex flex-col gap-4 overflow-y-auto">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="text-lg font-bold text-white truncate flex items-center gap-2">
                            <Sparkles size={17} className="text-purple-400 shrink-0" /> AI Clean: {target.title}
                        </h2>
                        <p className="text-xs text-slate-400 mt-1">
                            Runs only when you click it. Inspect every cut below and restore anything important before saving.
                        </p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 text-slate-400 hover:text-white"><X size={18} /></button>
                </div>

                {useApi ? (
                    <div className="flex gap-2 flex-wrap">
                        <button
                            type="button"
                            onClick={() => runAiClean(false)}
                            disabled={cleaning || !spec}
                            className="flex-1 inline-flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition-colors"
                        >
                            {cleaning ? <Activity className="animate-spin" size={15} /> : <Sparkles size={15} />}
                            {cleaning ? `Scanning${progress ? ` ${progress}` : ''} on ${ai.label}…` : 'Run AI Clean'}
                        </button>
                        {chunks.length > 1 && (
                            <button
                                type="button"
                                onClick={() => runAiClean(true)}
                                disabled={cleaning}
                                className="inline-flex items-center justify-center gap-2 border border-slate-700 hover:border-purple-500 disabled:opacity-40 text-slate-200 text-sm font-bold px-4 py-2.5 rounded-xl transition-colors"
                            >
                                Deep clean ({chunks.length} chunks)
                            </button>
                        )}
                    </div>
                ) : spec && (
                    <ManualAiPanel spec={spec} addNotification={addNotification} onResult={applyReply} />
                )}

                <CleanupTools
                    text={draftText}
                    setText={setDraftText}
                    rank={rank}
                    ai={ai}
                    disabled={cleaning}
                    onCuts={(items) => setCuts(prev => [...items, ...prev])}
                    addNotification={addNotification}
                />

                <CutReviewPanel cuts={cuts} onRestore={restoreOne} onRestoreAll={restoreAll} defaultOpen />

                <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-800">
                    <span className="text-xs text-slate-500">
                        {draftText.trim() ? draftText.trim().split(/\s+/).length.toLocaleString() : 0} words
                    </span>
                    <div className="flex gap-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white">
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={!changed}
                            onClick={() => { onSave(draftText); onClose(); }}
                            className="px-4 py-2 rounded-xl text-sm font-bold bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white"
                        >
                            Save changes
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function QuizModal({ target, ai, verifyQuestions, onSave, onClose, addNotification }) {
    const useApi = Boolean(ai?.generate);
    const [generating, setGenerating] = useState(false);
    const [pendingCheck, setPendingCheck] = useState(null);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const spec = useMemo(() => questionsForTextSpec({ title: target.title, text: target.text }), [target.title, target.text]);

    const saveQuiz = (questions, gistQuestions = []) => {
        if (questions.length === 0) {
            addNotification('Could not extract valid questions from that reply.');
            return;
        }
        onSave({ questions, gistQuestions });
        onClose();
    };

    const runGenerate = async () => {
        if (!useApi) return;
        setGenerating(true);
        try {
            const reply = await ai.generate({ prompt: spec.prompt, schema: spec.schema });
            let questions = normalizeQuestions(reply?.questions);
            const gistQuestions = normalizeQuestions(reply?.gistQuestions);

            if (verifyQuestions && questions.length > 0) {
                try {
                    const check = verifySpec({ questions });
                    const blind = await ai.generate({ prompt: check.prompt, schema: check.schema });
                    const { questions: kept, dropped } = dropGuessableQuestions(questions, blind?.answers);
                    if (dropped > 0) addNotification(`Dropped ${dropped} guessable question${dropped === 1 ? '' : 's'}.`);
                    questions = kept;
                } catch {
                    // Keep questions if blind check fails.
                }
            }
            saveQuiz(questions, gistQuestions);
        } catch (error) {
            addNotification(error.message || 'Quiz generation failed.');
        } finally {
            setGenerating(false);
        }
    };

    const acceptManual = (reply) => {
        const questions = normalizeQuestions(reply?.questions);
        const gistQuestions = normalizeQuestions(reply?.gistQuestions);
        if (questions.length === 0) throw new Error('No valid questions found in that reply.');
        if (verifyQuestions) {
            setPendingCheck({ questions, gistQuestions });
            return;
        }
        saveQuiz(questions, gistQuestions);
    };

    return (
        <div className="fixed inset-0 z-[60] grid place-items-center p-4">
            <button aria-label="Close quiz generator" className="absolute inset-0 bg-black/60" onClick={onClose} />
            <div role="dialog" aria-label={`Quiz for ${target.title}`} className="relative w-full max-w-2xl max-h-[85vh] bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl flex flex-col gap-4 overflow-y-auto">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="text-lg font-bold text-white truncate flex items-center gap-2">
                            <Brain size={17} className="text-emerald-400 shrink-0" /> Quiz: {target.title}
                        </h2>
                        <p className="text-xs text-slate-400 mt-1">
                            Generates 5 blind-checked comprehension questions so reading this adjusts your adaptive target WPM.
                        </p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 text-slate-400 hover:text-white"><X size={18} /></button>
                </div>

                {useApi ? (
                    <button
                        type="button"
                        onClick={runGenerate}
                        disabled={generating}
                        className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-bold px-4 py-3 rounded-xl transition-colors"
                    >
                        {generating ? <Activity className="animate-spin" size={16} /> : <Brain size={16} />}
                        {generating ? `Writing quiz on ${ai.label}…` : 'Generate 5-question quiz'}
                    </button>
                ) : pendingCheck ? (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2 bg-emerald-950/20 border border-emerald-900/60 rounded-xl p-3 text-xs text-emerald-300">
                            <span>Got {pendingCheck.questions.length} questions. Optional blind check:</span>
                            <button
                                type="button"
                                onClick={() => saveQuiz(pendingCheck.questions, pendingCheck.gistQuestions)}
                                className="px-3 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold"
                            >
                                Skip &amp; save
                            </button>
                        </div>
                        <ManualAiPanel
                            spec={verifySpec({ questions: pendingCheck.questions })}
                            addNotification={addNotification}
                            onResult={(blind) => {
                                const { questions: kept } = dropGuessableQuestions(pendingCheck.questions, blind?.answers);
                                saveQuiz(kept, pendingCheck.gistQuestions);
                            }}
                        />
                    </div>
                ) : (
                    <ManualAiPanel spec={spec} addNotification={addNotification} onResult={acceptManual} />
                )}
            </div>
        </div>
    );
}

function UploadedPassages({ passages, wpm, onOpenSaved, onDeleteSaved, onRemovePassageBookmark, onCleanDoc, onQuizDoc }) {
    if (passages.length === 0) return null;

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-7">
            <div className="flex items-center justify-between gap-4 mb-4">
                <h2 className="text-xl font-bold text-white">Uploaded documents</h2>
                <span className="text-sm text-slate-500">{passages.length}</span>
            </div>
            <div className="space-y-2.5">
                {passages.map(item => {
                    const partial = isPartiallyRead(item);
                    const at = resumePoint(item);
                    const pct = item.words ? Math.round((at / item.words) * 100) : 0;
                    const wordsLeft = Math.max(0, item.words - at);
                    const bookmarks = item.bookmarks ?? [];

                    return (
                        <div key={item.id} className="bg-slate-950 border border-slate-800 rounded-2xl p-4 hover:border-slate-700 transition-colors">
                            <div className="flex flex-col md:flex-row md:items-center gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <FileText size={15} className="text-purple-400 shrink-0" />
                                        <h3 className="font-bold text-white truncate">{item.title}</h3>
                                        {item.kind === 'push' && (
                                            <span className="text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded">Push</span>
                                        )}
                                        {item.questions?.length > 0 && (
                                            <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 px-1.5 py-0.5 rounded">{item.questions.length}Q</span>
                                        )}
                                        {item.completedAt && !partial && (
                                            <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 px-1.5 py-0.5 rounded">Done</span>
                                        )}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                                        <span>{item.words.toLocaleString()} words</span>
                                        <span>about {minutes(partial ? wordsLeft : item.words, wpm)} min {partial ? 'left ' : ''}at {wpm} WPM</span>
                                        {partial && <span className="text-amber-400">{pct}% read</span>}
                                        {bookmarks.length > 0 && <span>{bookmarks.length} bookmark{bookmarks.length === 1 ? '' : 's'}</span>}
                                    </div>
                                    {partial && (
                                        <div className="mt-2.5 h-1.5 bg-slate-800 rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${item.title} progress`}>
                                            <div className="h-full bg-purple-500" style={{ width: `${pct}%` }} />
                                        </div>
                                    )}
                                </div>
                                <div className="flex gap-2 shrink-0 flex-wrap">
                                    {item.text && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => onCleanDoc(item)}
                                                title="Clean clutter with AI and review cuts"
                                                className="border border-slate-700 hover:border-purple-500 text-slate-300 hover:text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5"
                                            >
                                                <Sparkles size={13} className="text-purple-400" /> AI Clean
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => onQuizDoc(item)}
                                                title="Generate comprehension quiz"
                                                className="border border-slate-700 hover:border-emerald-500 text-slate-300 hover:text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5"
                                            >
                                                <Brain size={13} className="text-emerald-400" /> {item.questions?.length ? 'Re-quiz' : 'Add quiz'}
                                            </button>
                                        </>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => onOpenSaved(item.id)}
                                        className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
                                    >
                                        <Play size={14} className="fill-current" />
                                        {partial ? 'Resume' : item.completedAt ? 'Read again' : 'Speed Read'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onDeleteSaved(item.id)}
                                        className="text-slate-600 hover:text-red-400 px-2 transition-colors"
                                        aria-label={`Delete ${item.title}`}
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>

                            {bookmarks.length > 0 && (
                                <details className="group mt-3">
                                    <summary className="cursor-pointer select-none text-xs font-bold text-slate-400 hover:text-white flex items-center gap-1">
                                        <ChevronRight size={13} className="group-open:rotate-90 transition-transform" /> Bookmarks &amp; notes ({bookmarks.length})
                                    </summary>
                                    <ul className="mt-2 space-y-1">
                                        {bookmarks.map(bm => (
                                            <li key={bm.id} className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => onOpenSaved(item.id, { resumeAt: bm.index })}
                                                    className="flex-1 min-w-0 flex items-start gap-2 px-3 py-2 rounded-lg text-left hover:bg-slate-800/70 transition-colors"
                                                >
                                                    <Bookmark size={13} className="text-amber-400 mt-0.5 shrink-0" />
                                                    <span className="min-w-0">
                                                        <span className="block text-xs text-slate-400">{bm.createdAt}</span>
                                                        <span className="block text-sm text-slate-200 truncate">{bm.snippet}</span>
                                                        {bm.note && <span className="block text-xs text-amber-300/90 mt-0.5">{bm.note}</span>}
                                                    </span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => onRemovePassageBookmark?.(item.id, bm.id)}
                                                    aria-label="Remove bookmark"
                                                    className="p-1.5 text-slate-600 hover:text-red-400"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </details>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default function Documents({
    ai, verifyQuestions = true, library, readingWpm = 300, onOpenSaved, onDeleteSaved,
    onUpdateDocumentText, onUpdateChapterText, onUpdateDocumentQuestions, onUpdateChapterQuestions,
    onOpenChapter, onRemoveBookmark, onRemovePassageBookmark, onOpenUpload, addNotification, onPractiseChapter = null,
    onSaveBook = null, freeBooksRequest = 0
}) {
    const [query, setQuery] = useState('');
    const [cleaningTarget, setCleaningTarget] = useState(null);
    const [quizTarget, setQuizTarget] = useState(null);
    const books = library.filter(isBook);
    const importedPassages = library.filter(item => !isBook(item) && item.source === 'import');
    const totalItems = books.length + importedPassages.length;
    const totalBookmarks = books.reduce((n, b) => n + (b.bookmarks?.length ?? 0), 0)
        + importedPassages.reduce((n, p) => n + (p.bookmarks?.length ?? 0), 0);

    const q = query.trim().toLowerCase();
    const filteredBooks = q ? books.filter(b => b.title.toLowerCase().includes(q)) : books;
    const filteredPassages = q ? importedPassages.filter(p => p.title.toLowerCase().includes(q)) : importedPassages;

    return (
        <div className="max-w-4xl mx-auto space-y-6 animate-in slide-in-from-bottom-4 pb-12">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                        <FileText className="text-purple-500 w-7 h-7" /> Documents
                    </h1>
                    <p className="text-slate-400 mt-2 max-w-2xl leading-relaxed">
                        Your uploaded books and documents, ready to speed read at {readingWpm} WPM. Progress, bookmarks, and notes save automatically.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {totalBookmarks > 0 && (
                        <button
                            type="button"
                            onClick={() => exportNotesMarkdown(books, importedPassages)}
                            className="inline-flex items-center gap-2 border border-slate-700 hover:border-slate-500 text-slate-200 text-sm font-bold px-3.5 py-2.5 rounded-xl transition-colors"
                        >
                            <Download size={15} /> Export notes ({totalBookmarks})
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onOpenUpload}
                        className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition-colors"
                    >
                        <Upload size={16} /> Upload new
                    </button>
                </div>
            </div>

            {totalItems >= 3 && (
                <div className="relative">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Filter documents and books..."
                        aria-label="Filter documents and books"
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500 transition-colors"
                    />
                </div>
            )}

            {totalItems === 0 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-slate-800 grid place-items-center text-purple-400 mx-auto mb-4">
                        <BookOpen size={22} />
                    </div>
                    <h2 className="text-xl font-bold text-white">No documents yet</h2>
                    <p className="text-sm text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
                        Upload a PDF, EPUB, DOCX, HTML, Markdown, or text file — or paste text — in the Upload tab to start speed reading.
                        {onSaveBook && ' Or add a free classic from the shelf below.'}
                    </p>
                    <button
                        type="button"
                        onClick={onOpenUpload}
                        className="mt-5 inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold px-5 py-3 rounded-xl transition-colors"
                    >
                        <Upload size={16} /> Go to Upload
                    </button>
                </div>
            ) : (
                <>
                    <BookShelf
                        books={filteredBooks}
                        wpm={readingWpm}
                        onOpenChapter={(bookId, chIdx, resumeAt) => onOpenChapter(bookId, chIdx, resumeAt, 'documents')}
                        onRemoveBookmark={onRemoveBookmark}
                        onDelete={onDeleteSaved}
                        onCleanChapter={(book, chIdx) => setCleaningTarget({
                            kind: 'chapter',
                            bookId: book.id,
                            chapterIndex: chIdx,
                            title: `${book.title} · ${book.chapters[chIdx].title}`,
                            text: book.chapters[chIdx].text
                        })}
                        onPractiseChapter={onPractiseChapter}
                        onQuizChapter={(book, chIdx) => setQuizTarget({
                            kind: 'chapter',
                            bookId: book.id,
                            chapterIndex: chIdx,
                            title: `${book.title} · ${book.chapters[chIdx].title}`,
                            text: book.chapters[chIdx].text
                        })}
                    />
                    <UploadedPassages
                        passages={filteredPassages}
                        wpm={readingWpm}
                        onOpenSaved={(id, opts) => onOpenSaved(id, { ...opts, returnTo: 'documents' })}
                        onDeleteSaved={onDeleteSaved}
                        onRemovePassageBookmark={onRemovePassageBookmark}
                        onCleanDoc={(doc) => setCleaningTarget({ kind: 'doc', id: doc.id, title: doc.title, text: doc.text })}
                        onQuizDoc={(doc) => setQuizTarget({ kind: 'doc', id: doc.id, title: doc.title, text: doc.text })}
                    />
                    {q && filteredBooks.length === 0 && filteredPassages.length === 0 && (
                        <p className="text-sm text-slate-500 text-center py-6">No documents match &ldquo;{query}&rdquo;.</p>
                    )}
                </>
            )}

            {onSaveBook && (
                <FreeBooks
                    // A new request (from Upload's "Browse free books") opens the shelf and scrolls to it.
                    key={freeBooksRequest}
                    library={library}
                    readingWpm={readingWpm}
                    onSaveBook={onSaveBook}
                    onOpenBook={(book) => onOpenChapter(book.id, book.currentChapter ?? 0, null, 'documents')}
                    addNotification={addNotification}
                    defaultOpen={totalItems === 0 || freeBooksRequest > 0}
                    scrollIntoView={freeBooksRequest > 0}
                />
            )}

            {cleaningTarget && (
                <AiCleanModal
                    target={cleaningTarget}
                    ai={ai}
                    onSave={(nextText) => (cleaningTarget.kind === 'chapter'
                        ? onUpdateChapterText(cleaningTarget.bookId, cleaningTarget.chapterIndex, nextText)
                        : onUpdateDocumentText(cleaningTarget.id, nextText))}
                    onClose={() => setCleaningTarget(null)}
                    addNotification={addNotification}
                />
            )}

            {quizTarget && (
                <QuizModal
                    target={quizTarget}
                    ai={ai}
                    verifyQuestions={verifyQuestions}
                    onSave={(qData) => (quizTarget.kind === 'chapter'
                        ? onUpdateChapterQuestions(quizTarget.bookId, quizTarget.chapterIndex, qData)
                        : onUpdateDocumentQuestions(quizTarget.id, qData))}
                    onClose={() => setQuizTarget(null)}
                    addNotification={addNotification}
                />
            )}
        </div>
    );
}
