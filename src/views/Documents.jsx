import { useRef, useState } from 'react';
import { Activity, FileText, Play, Upload } from 'lucide-react';
import { splitPassage } from '../lib/protocol';
import { isPartiallyRead, resumePoint } from '../lib/library';
import { ACCEPT_ATTRIBUTE, SUPPORTED_EXTENSIONS, extractText } from '../lib/importText';
import { BOOK_MIN_WORDS, buildChapters, createBook, isBook } from '../lib/book';
import BookShelf from '../components/BookShelf';

function UploadedPassages({ passages, onOpenSaved, onDeleteSaved }) {
    if (passages.length === 0) return null;

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-7">
            <div className="flex items-center justify-between gap-4 mb-4">
                <h2 className="text-xl font-bold text-white">Saved documents</h2>
                <span className="text-sm text-slate-500">{passages.length}</span>
            </div>
            <div className="space-y-2">
                {passages.map(item => {
                    const partial = isPartiallyRead(item);
                    return (
                        <div key={item.id} className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-4 hover:border-slate-700 transition-colors">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h3 className="font-bold text-white truncate">{item.title}</h3>
                                    {item.kind === 'push' && (
                                        <span className="text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded">Push</span>
                                    )}
                                </div>
                                <div className="text-xs text-slate-500 mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                                    <span>{item.words.toLocaleString()} words</span>
                                    {partial && <span className="text-amber-400">{Math.round((resumePoint(item) / item.words) * 100)}% read</span>}
                                </div>
                            </div>
                            <div className="flex gap-2 shrink-0">
                                <button
                                    onClick={() => onOpenSaved(item.id)}
                                    className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors"
                                >
                                    {partial ? 'Resume' : item.completedAt ? 'Read again' : 'Read'}
                                </button>
                                <button
                                    onClick={() => onDeleteSaved(item.id)}
                                    className="text-slate-600 hover:text-red-400 px-2 transition-colors"
                                    aria-label={`Delete ${item.title}`}
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

const nextId = (prefix) => `${prefix}-${Date.now()}`;

export default function Documents({
    library, readingWpm = 300, onStartPassage, onStartPushDrill, onOpenSaved, onDeleteSaved,
    onSaveBook, onOpenChapter, onRemoveBookmark, addNotification
}) {
    const [customText, setCustomText] = useState('');
    const [importedTitle, setImportedTitle] = useState(null);
    // The file's own chapters (EPUB), kept until the text is edited by hand.
    const [importedChapters, setImportedChapters] = useState(null);
    const [importing, setImporting] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const fileRef = useRef(null);

    const loadFile = async (file) => {
        if (!file) return;
        setImporting(true);
        try {
            const { title, text, chapters } = await extractText(file);
            setCustomText(text);
            setImportedTitle(title);
            setImportedChapters(chapters);
            addNotification(`Loaded ${text.split(/\s+/).length.toLocaleString()} words from ${file.name}.`);
        } catch (error) {
            console.error('Import error:', error);
            setImportedTitle(null);
            setImportedChapters(null);
            addNotification(error.message || 'Could not read that file.');
        } finally {
            setImporting(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        loadFile(e.dataTransfer.files?.[0]);
    };

    const handleCustomStart = () => {
        if (!customText.trim()) return;
        onStartPassage({
            id: nextId('custom'),
            title: importedTitle || 'Custom Imported Text',
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
            title: importedTitle ? `${importedTitle} (Speed Push)` : 'Custom Speed Push',
            ...sections,
            questions: []
        }, { source: 'import', returnTo: 'documents' });
    };

    const wordCount = customText.trim() ? customText.trim().split(/\s+/).length : 0;
    const canBeBook = wordCount >= BOOK_MIN_WORDS || (importedChapters?.length ?? 0) > 1;
    const estMinutes = Math.max(1, Math.round(wordCount / Math.max(100, readingWpm)));

    const handleAddBook = () => {
        const chapters = buildChapters({ text: customText, chapters: importedChapters });
        if (chapters.length < 2) {
            addNotification('Not enough text to split into chapters. Read it as one passage instead.');
            return;
        }
        if (onSaveBook(createBook({ title: importedTitle || 'Imported book', chapters })) === false) return;
        setCustomText('');
        setImportedTitle(null);
        setImportedChapters(null);
    };

    const books = library.filter(isBook);
    const importedPassages = library.filter(item => !isBook(item) && item.source === 'import');

    return (
        <div className="max-w-4xl mx-auto space-y-6 animate-in slide-in-from-bottom-4 pb-12">
            <div>
                <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                    <FileText className="text-purple-500 w-7 h-7" /> Documents
                </h1>
                <p className="text-slate-400 mt-2 max-w-2xl leading-relaxed">
                    Upload a document or paste text to read it with the speed reader. Works offline — no AI involved.
                </p>
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
                            {importing ? <Activity className="animate-spin" size={16} /> : <Upload size={16} />}
                            {importing ? 'Reading file...' : 'Choose a file'}
                        </button>
                        <span className="text-xs text-slate-500">or drop one anywhere in this box</span>
                        <input
                            ref={fileRef}
                            type="file"
                            accept={ACCEPT_ATTRIBUTE}
                            className="hidden"
                            aria-label="Choose a document to import"
                            onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }}
                        />
                    </div>

                    <p className="text-[11px] text-slate-600">
                        Supported: {SUPPORTED_EXTENSIONS.join('   ')} — long articles or books can be split into chapters.
                    </p>

                    {importedTitle && (
                        <div className="text-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-300 truncate">
                            <span className="text-slate-500">Loaded:</span> {importedTitle}
                        </div>
                    )}

                    <textarea
                        value={customText}
                        onChange={(e) => { setCustomText(e.target.value); setImportedTitle(null); setImportedChapters(null); }}
                        placeholder="...or paste text straight in here."
                        aria-label="Document text to read"
                        className="w-full min-h-[12rem] bg-slate-950 border border-slate-700 rounded-xl p-4 text-white resize-y focus:outline-none focus:border-purple-500 transition-colors text-sm"
                    />

                    {wordCount > 0 && (
                        <p className="text-xs text-slate-500">
                            {wordCount.toLocaleString()} words · about {estMinutes} min at {readingWpm} WPM
                        </p>
                    )}

                    {canBeBook && (
                        <button
                            type="button"
                            onClick={handleAddBook}
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
                            <span className="block text-[11px] font-normal text-purple-100/80 mt-0.5">RSVP, Paced, Natural, or Skim</span>
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

            <BookShelf
                books={books}
                wpm={readingWpm}
                onOpenChapter={(bookId, chIdx, resumeAt) => onOpenChapter(bookId, chIdx, resumeAt, 'documents')}
                onRemoveBookmark={onRemoveBookmark}
                onDelete={onDeleteSaved}
            />

            <UploadedPassages
                passages={importedPassages}
                onOpenSaved={(id) => onOpenSaved(id, { returnTo: 'documents' })}
                onDeleteSaved={onDeleteSaved}
            />
        </div>
    );
}
