import { useMemo, useRef, useState } from 'react';
import {
    Activity, AlertTriangle, ChevronRight, Eraser, Globe, HardDrive, Play, Sparkles, Undo2, Upload as UploadIcon
} from 'lucide-react';
import { cleanDocSpec } from '../lib/ai';
import { splitPassage } from '../lib/protocol';
import {
    ACCEPT_ATTRIBUTE, SUPPORTED_EXTENSIONS, applyParagraphCuts, extractFromHtml, extractText,
    normalizeTextWithStats, restoreCutItem, selectBlocksForAiClean
} from '../lib/importText';
import { BOOK_MIN_WORDS, buildChapters, createBook } from '../lib/book';
import CutReviewPanel from '../components/CutReviewPanel';
import ManualAiPanel from '../components/ManualAiPanel';

const nextId = (prefix) => `${prefix}-${Date.now()}`;

function formatCleanSummary(stats) {
    if (!stats) return '';
    const parts = [];
    if (stats.repeatedHeaders) parts.push(`${stats.repeatedHeaders} page header/footer${stats.repeatedHeaders === 1 ? '' : 's'}`);
    if (stats.pageNumbers) parts.push(`${stats.pageNumbers} page number${stats.pageNumbers === 1 ? '' : 's'}`);
    if (stats.rejoinedHyphens) parts.push(`${stats.rejoinedHyphens} hyphenated wrap${stats.rejoinedHyphens === 1 ? '' : 's'}`);
    if (stats.junkChars) parts.push(`${stats.junkChars} stray char${stats.junkChars === 1 ? '' : 's'}`);
    if (stats.dotLeaders) parts.push(`${stats.dotLeaders} dot leader${stats.dotLeaders === 1 ? '' : 's'}`);
    return parts.join(' · ');
}

export default function Upload({
    ai, library = [], readingWpm = 300, onStartPassage, onStartPushDrill, onSaveBook, onSavePassage,
    onOpenSaved, onDeleteSaved, onOpenDocuments, addNotification
}) {
    const useApi = Boolean(ai?.generate);
    const [customText, setCustomText] = useState('');
    const [rawBeforeClean, setRawBeforeClean] = useState(null);
    const [cleanStats, setCleanStats] = useState(null);
    const [cutLog, setCutLog] = useState([]);
    const [aiCleaning, setAiCleaning] = useState(false);
    const [manualAiOpen, setManualAiOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [articleUrl, setArticleUrl] = useState('');
    const [fetchingUrl, setFetchingUrl] = useState(false);
    // The file's own chapters (EPUB or PDF outline), kept until the text is edited by hand.
    const [importedChapters, setImportedChapters] = useState(null);
    const [importing, setImporting] = useState(false);
    const [pdfProgress, setPdfProgress] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const [stripUrls, setStripUrls] = useState(false);
    const [stripCitations, setStripCitations] = useState(false);
    const fileRef = useRef(null);

    const libraryBytes = useMemo(() => JSON.stringify(library).length * 2, [library]);

    const duplicate = useMemo(() => {
        const norm = title.trim().toLowerCase();
        if (!norm) return null;
        return library.find(item => item.title?.trim().toLowerCase() === norm) ?? null;
    }, [library, title]);

    const importBatch = async (files) => {
        let added = 0;
        for (const file of files) {
            try {
                const res = await extractText(file, {
                    stripUrls,
                    stripCitations,
                    onProgress: (p) => setPdfProgress({ ...p, name: file.name })
                });
                const wc = res.text.trim().split(/\s+/).length;
                if (wc >= BOOK_MIN_WORDS || (res.chapters?.length ?? 0) > 1) {
                    const chapters = buildChapters({ text: res.text, chapters: res.chapters });
                    if (chapters.length >= 2) {
                        if (onSaveBook(createBook({ title: res.title, chapters })) !== false) added += 1;
                        continue;
                    }
                }
                onSavePassage?.({ id: nextId('custom'), title: res.title, text: res.text, questions: [] });
                added += 1;
            } catch (error) {
                addNotification(`${file.name}: ${error.message || 'Could not read file.'}`);
            }
        }
        if (added > 0) {
            addNotification(`Added ${added} document${added === 1 ? '' : 's'} to Documents.`, 'success');
            onOpenDocuments?.();
        }
    };

    const loadFiles = async (fileList) => {
        const files = [...(fileList ?? [])].filter(Boolean);
        if (files.length === 0) return;
        setImporting(true);
        setPdfProgress(null);
        setManualAiOpen(false);
        try {
            if (files.length > 1) {
                await importBatch(files);
                return;
            }
            const file = files[0];
            const res = await extractText(file, {
                stripUrls,
                stripCitations,
                onProgress: (p) => setPdfProgress({ ...p, name: file.name })
            });
            setCustomText(res.text);
            setRawBeforeClean(res.rawText ?? null);
            setCleanStats(res.stats ?? null);
            setCutLog(res.cuts ?? []);
            setTitle(res.title);
            setImportedChapters(res.chapters);
            addNotification(`Loaded ${res.text.split(/\s+/).length.toLocaleString()} words from ${file.name}.`);
        } catch (error) {
            console.error('Import error:', error);
            setImportedChapters(null);
            addNotification(error.message || 'Could not read that file.');
        } finally {
            setImporting(false);
            setPdfProgress(null);
        }
    };

    const handleFetchUrl = async (e) => {
        e.preventDefault();
        const url = articleUrl.trim();
        if (!url) return;
        setFetchingUrl(true);
        setManualAiOpen(false);
        try {
            const resp = await fetch(`/api/fetch-article?url=${encodeURIComponent(url)}`);
            if (resp.status === 404) {
                throw new Error('URL import requires the local dev or preview server.');
            }
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Could not fetch that URL.');
            const extracted = extractFromHtml(data.html);
            const { text, stats, cuts } = normalizeTextWithStats(extracted.text, { stripUrls, stripCitations });
            if (!text || text.split(/\s+/).length < 10) {
                throw new Error('That page did not contain enough readable article text.');
            }
            setCustomText(text);
            setRawBeforeClean(extracted.text);
            setCleanStats(stats);
            setCutLog(cuts);
            setTitle(extracted.title || extracted.heading || new URL(url).hostname);
            setImportedChapters(null);
            addNotification(`Imported ${text.split(/\s+/).length.toLocaleString()} words from ${new URL(url).hostname}.`, 'success');
        } catch (error) {
            addNotification(error.message || 'Could not import that URL.');
        } finally {
            setFetchingUrl(false);
        }
    };

    const handleCleanClick = () => {
        setRawBeforeClean(customText);
        const { text, stats, cuts } = normalizeTextWithStats(customText, { stripUrls, stripCitations });
        setCustomText(text);
        setCleanStats(stats);
        setCutLog(prev => [...prev, ...cuts]);
        addNotification('Cleaned formatting and stray characters.');
    };

    const applyAiCuts = (reply) => {
        const cuts = Array.isArray(reply?.cuts) ? reply.cuts : [];
        if (cuts.length === 0) {
            addNotification('AI found no extra clutter to cut.');
            setManualAiOpen(false);
            return;
        }
        setRawBeforeClean(prev => prev ?? customText);
        const { text, cutItems } = applyParagraphCuts(customText, cuts);
        if (cutItems.length === 0) {
            addNotification('AI found no matching blocks to cut.');
            setManualAiOpen(false);
            return;
        }
        setCustomText(text);
        setCutLog(prev => [...cutItems, ...prev]);
        setManualAiOpen(false);
        addNotification(`AI cut ${cutItems.length} clutter block${cutItems.length === 1 ? '' : 's'} — review in diff below.`, 'success');
    };

    const aiBlocks = useMemo(() => (customText.trim() ? selectBlocksForAiClean(customText) : []), [customText]);
    const aiCleanSpec = useMemo(() => (aiBlocks.length > 0 ? cleanDocSpec({ blocks: aiBlocks }) : null), [aiBlocks]);

    const handleAiClean = async () => {
        if (!aiCleanSpec) return;
        if (!useApi) {
            setManualAiOpen(o => !o);
            return;
        }
        setAiCleaning(true);
        try {
            const reply = await ai.generate({ prompt: aiCleanSpec.prompt, schema: aiCleanSpec.schema });
            applyAiCuts(reply);
        } catch (error) {
            addNotification(error.message || 'AI cleanup failed.');
        } finally {
            setAiCleaning(false);
        }
    };

    const handleRestoreCut = (cutItem) => {
        setCustomText(prev => restoreCutItem(prev, cutItem));
        setCutLog(prev => prev.filter(c => c.id !== cutItem.id));
    };

    const handleRestoreAllCuts = () => {
        if (rawBeforeClean !== null) {
            setCustomText(rawBeforeClean);
            setRawBeforeClean(null);
            setCleanStats(null);
            setCutLog([]);
            return;
        }
        let next = customText;
        for (const item of [...cutLog].reverse()) {
            next = restoreCutItem(next, item);
        }
        setCustomText(next);
        setCutLog([]);
    };

    const handleUndoClean = () => {
        if (rawBeforeClean === null) return;
        setCustomText(rawBeforeClean);
        setRawBeforeClean(null);
        setCleanStats(null);
        setCutLog([]);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        loadFiles(e.dataTransfer.files);
    };

    const handleCustomStart = () => {
        if (!customText.trim()) return;
        onStartPassage({
            id: nextId('custom'),
            title: title.trim() || 'Custom Imported Text',
            text: customText,
            questions: []
        }, { source: 'import', returnTo: 'documents' });
    };

    const handleCustomPush = () => {
        const sections = splitPassage(customText);
        if (!sections) {
            addNotification('Need roughly 150+ words to split into two drill sections.');
            return;
        }
        onStartPushDrill({
            id: nextId('push-custom'),
            title: title.trim() ? `${title.trim()} (Speed Push)` : 'Custom Speed Push',
            ...sections,
            questions: []
        }, { source: 'import', returnTo: 'documents' });
    };

    const wordCount = customText.trim() ? customText.trim().split(/\s+/).length : 0;
    const canBeBook = wordCount >= BOOK_MIN_WORDS || (importedChapters?.length ?? 0) > 1;
    const estMinutes = Math.max(1, Math.round(wordCount / Math.max(100, readingWpm)));

    const previewChapters = useMemo(() => {
        if (!canBeBook || !customText.trim()) return [];
        return buildChapters({ text: customText, chapters: importedChapters });
    }, [canBeBook, customText, importedChapters]);

    const handleAddBook = (replaceId = null) => {
        if (previewChapters.length < 2) {
            addNotification('Not enough text to split into chapters. Read it as one passage instead.');
            return;
        }
        if (replaceId) onDeleteSaved?.(replaceId);
        if (onSaveBook(createBook({ title: title.trim() || 'Imported book', chapters: previewChapters })) === false) return;
        setCustomText('');
        setRawBeforeClean(null);
        setCleanStats(null);
        setCutLog([]);
        setTitle('');
        setImportedChapters(null);
        onOpenDocuments?.();
    };

    const cleanSummary = formatCleanSummary(cleanStats);

    return (
        <div className="max-w-4xl mx-auto space-y-6 animate-in slide-in-from-bottom-4 pb-12">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                        <UploadIcon className="text-purple-500 w-7 h-7" /> Upload
                    </h1>
                    <p className="text-slate-400 mt-2 max-w-2xl leading-relaxed">
                        Import EPUB, PDF, DOCX, HTML, Markdown, or text files — or paste an article URL or text directly.
                    </p>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                        <HardDrive size={13} className="text-purple-400" />
                        <span>IndexedDB library: <strong className="font-mono text-slate-200">{(libraryBytes / 1e6).toFixed(2)} MB</strong></span>
                    </div>
                </div>
            </div>

            <div className={`bg-slate-900 border rounded-3xl p-6 md:p-7 transition-colors ${isDragging ? 'border-purple-500 bg-purple-950/15' : 'border-slate-800'}`}>
                {/* A drop target, not a control: the picker and textarea below are the
                    keyboard paths, so this adds a shortcut for mouse users. */}
                {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
                <div
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    className="space-y-4"
                >
                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            type="button"
                            onClick={() => fileRef.current?.click()}
                            disabled={importing}
                            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition-colors"
                        >
                            {importing ? <Activity className="animate-spin" size={16} /> : <UploadIcon size={16} />}
                            {importing ? 'Reading file...' : 'Choose file(s)'}
                        </button>
                        <span className="text-xs text-slate-500">or drop one or more anywhere in this box</span>
                        <input
                            ref={fileRef}
                            type="file"
                            multiple
                            accept={ACCEPT_ATTRIBUTE}
                            className="hidden"
                            aria-label="Choose documents to import"
                            onChange={(e) => { loadFiles(e.target.files); e.target.value = ''; }}
                        />
                    </div>

                    <form onSubmit={handleFetchUrl} className="flex gap-2 flex-col sm:flex-row">
                        <div className="relative flex-1">
                            <Globe size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                            <input
                                type="url"
                                value={articleUrl}
                                onChange={(e) => setArticleUrl(e.target.value)}
                                placeholder="https://... paste an article URL to import"
                                aria-label="Article URL"
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-3.5 py-2 text-sm text-white focus:outline-none focus:border-purple-500 transition-colors"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={fetchingUrl || !articleUrl.trim()}
                            className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors shrink-0"
                        >
                            {fetchingUrl ? 'Fetching...' : 'Fetch article'}
                        </button>
                    </form>

                    {pdfProgress && (
                        <div className="space-y-1.5">
                            <div className="flex justify-between text-xs text-slate-400">
                                <span className="truncate">Reading {pdfProgress.name}…</span>
                                <span className="font-mono shrink-0">Page {pdfProgress.page} / {pdfProgress.totalPages}</span>
                            </div>
                            <progress
                                value={pdfProgress.page}
                                max={pdfProgress.totalPages}
                                className="w-full h-1.5 rounded-full overflow-hidden accent-purple-500"
                            />
                        </div>
                    )}

                    <p className="text-[11px] text-slate-600">
                        Supported: {SUPPORTED_EXTENSIONS.join('   ')} — multi-column PDFs, PDF outlines, Word headings, and Markdown are handled automatically.
                    </p>

                    <div>
                        <label htmlFor="upload-title" className="block text-xs font-bold text-slate-400 mb-1.5">Title</label>
                        <input
                            id="upload-title"
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Optional title (auto-filled from file)"
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-purple-500 transition-colors"
                        />
                    </div>

                    {duplicate && (
                        <div className="flex items-center justify-between gap-3 flex-wrap bg-amber-950/25 border border-amber-800/50 rounded-xl px-4 py-2.5 text-xs">
                            <span className="flex items-center gap-2 text-amber-300">
                                <AlertTriangle size={14} className="shrink-0" />
                                Already in your library ({duplicate.words.toLocaleString()} words).
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => onOpenSaved?.(duplicate.id)}
                                    className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold transition-colors"
                                >
                                    Open existing
                                </button>
                                {canBeBook ? (
                                    <button
                                        type="button"
                                        onClick={() => handleAddBook(duplicate.id)}
                                        className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold transition-colors"
                                    >
                                        Replace book
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!customText.trim()) return;
                                            onDeleteSaved?.(duplicate.id);
                                            handleCustomStart();
                                        }}
                                        disabled={!customText.trim()}
                                        className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-bold transition-colors"
                                    >
                                        Replace &amp; read
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    <textarea
                        value={customText}
                        onChange={(e) => { setCustomText(e.target.value); setImportedChapters(null); }}
                        placeholder="...or paste text straight in here."
                        aria-label="Document text to read"
                        className="w-full min-h-[14rem] bg-slate-950 border border-slate-700 rounded-xl p-4 text-white resize-y focus:outline-none focus:border-purple-500 transition-colors text-sm"
                    />

                    {(cleanSummary || rawBeforeClean !== null) && (
                        <div className="flex items-center justify-between gap-2 flex-wrap bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-400">
                            <span>{cleanSummary ? `Cleaned: ${cleanSummary}` : 'Text cleaned.'}</span>
                            {rawBeforeClean !== null && (
                                <button
                                    type="button"
                                    onClick={handleUndoClean}
                                    className="inline-flex items-center gap-1 text-purple-400 hover:text-purple-300 font-bold"
                                >
                                    <Undo2 size={12} /> Undo clean
                                </button>
                            )}
                        </div>
                    )}

                    <CutReviewPanel
                        cuts={cutLog}
                        onRestore={handleRestoreCut}
                        onRestoreAll={handleRestoreAllCuts}
                        defaultOpen={cutLog.some(c => c.source === 'ai')}
                    />

                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-4 flex-wrap text-xs text-slate-400">
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={stripUrls}
                                    onChange={(e) => setStripUrls(e.target.checked)}
                                    className="accent-purple-500"
                                />
                                Strip URLs
                            </label>
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={stripCitations}
                                    onChange={(e) => setStripCitations(e.target.checked)}
                                    className="accent-purple-500"
                                />
                                Strip [1] citations
                            </label>
                        </div>

                        {wordCount > 0 && (
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs text-slate-500 mr-1">
                                    {wordCount.toLocaleString()} words · ~{estMinutes} min at {readingWpm} WPM
                                </span>
                                <button
                                    type="button"
                                    onClick={handleCleanClick}
                                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white border border-slate-800 hover:border-slate-600 px-3 py-1.5 rounded-lg transition-colors"
                                >
                                    <Eraser size={13} /> Clean text
                                </button>
                                <button
                                    type="button"
                                    onClick={handleAiClean}
                                    disabled={aiCleaning || !aiCleanSpec}
                                    title={ai?.note}
                                    className="inline-flex items-center gap-1.5 text-xs font-bold text-purple-300 hover:text-white border border-purple-700/60 bg-purple-950/30 hover:bg-purple-900/40 disabled:opacity-40 px-3 py-1.5 rounded-lg transition-colors"
                                >
                                    {aiCleaning ? <Activity className="animate-spin" size={13} /> : <Sparkles size={13} />}
                                    {aiCleaning ? `Cleaning on ${ai.label}…` : 'AI Clean'}
                                </button>
                            </div>
                        )}
                    </div>

                    {manualAiOpen && !useApi && aiCleanSpec && (
                        <ManualAiPanel
                            spec={aiCleanSpec}
                            addNotification={addNotification}
                            onResult={applyAiCuts}
                        />
                    )}

                    {previewChapters.length >= 2 && (
                        <details className="group bg-slate-950 border border-slate-800 rounded-xl">
                            <summary className="cursor-pointer select-none px-4 py-2.5 flex items-center justify-between text-xs font-bold text-slate-300 hover:text-white">
                                <span className="flex items-center gap-1.5">
                                    <ChevronRight size={14} className="group-open:rotate-90 transition-transform" />
                                    Chapter preview ({previewChapters.length} {importedChapters?.length > 1 ? 'chapters' : 'parts'})
                                </span>
                                <span className="text-slate-500 font-normal">Saved per chapter</span>
                            </summary>
                            <ol className="px-4 pb-3 pt-1 space-y-1 max-h-44 overflow-y-auto text-xs text-slate-400">
                                {previewChapters.map((ch, i) => (
                                    <li key={i} className="flex justify-between gap-2">
                                        <span className="truncate">{i + 1}. {ch.title}</span>
                                        <span className="font-mono text-slate-500 shrink-0">{ch.text.split(/\s+/).length.toLocaleString()}w</span>
                                    </li>
                                ))}
                            </ol>
                        </details>
                    )}

                    {canBeBook && (
                        <button
                            type="button"
                            onClick={() => handleAddBook(null)}
                            className="w-full bg-slate-800 hover:bg-slate-700 border border-purple-500/40 text-white font-bold py-3.5 rounded-xl transition-colors"
                        >
                            Add as a book
                            <span className="block text-[11px] font-normal text-slate-400 mt-0.5">
                                {importedChapters?.length > 1 ? 'Uses the file’s own chapters' : 'Split into chapters'} · progress saved per chapter · bookmarks
                            </span>
                        </button>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={handleCustomStart}
                            disabled={!customText.trim()}
                            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-bold py-3.5 rounded-xl transition-colors flex flex-col items-center justify-center"
                        >
                            <span className="flex items-center gap-2"><Play size={16} className="fill-current" /> Read with Speed Reader</span>
                            <span className="block text-[11px] font-normal text-purple-100/80 mt-0.5">RSVP, Paced, Scroll, Natural, or Skim</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleCustomPush}
                            disabled={!customText.trim()}
                            className="border border-slate-700 hover:border-purple-500 disabled:opacity-40 text-slate-200 font-bold py-3.5 rounded-xl transition-colors"
                        >
                            Push drill it
                            <span className="block text-[11px] font-normal text-slate-500 mt-0.5">Split in two, 1× / 2× / 3×</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
