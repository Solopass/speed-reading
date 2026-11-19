import { useState } from 'react';
import { Bookmark, BookOpen, ChevronRight, Download, FileText, Play, Search, Upload, X } from 'lucide-react';
import { isPartiallyRead, resumePoint } from '../lib/library';
import { isBook } from '../lib/book';
import BookShelf from '../components/BookShelf';

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

function UploadedPassages({ passages, wpm, onOpenSaved, onDeleteSaved, onRemovePassageBookmark }) {
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
                                <div className="flex gap-2 shrink-0">
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
    library, readingWpm = 300, onOpenSaved, onDeleteSaved,
    onOpenChapter, onRemoveBookmark, onRemovePassageBookmark, onOpenUpload
}) {
    const [query, setQuery] = useState('');
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
                    />
                    <UploadedPassages
                        passages={filteredPassages}
                        wpm={readingWpm}
                        onOpenSaved={(id, opts) => onOpenSaved(id, { ...opts, returnTo: 'documents' })}
                        onDeleteSaved={onDeleteSaved}
                        onRemovePassageBookmark={onRemovePassageBookmark}
                    />
                    {q && filteredBooks.length === 0 && filteredPassages.length === 0 && (
                        <p className="text-sm text-slate-500 text-center py-6">No documents match &ldquo;{query}&rdquo;.</p>
                    )}
                </>
            )}
        </div>
    );
}
