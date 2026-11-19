import { Bookmark, BookOpen, Check, ChevronRight, Play, Trash2, X } from 'lucide-react';
import { bookProgress, nextChapterIndex } from '../lib/book';

const minutes = (words, wpm) => Math.max(1, Math.round(words / Math.max(100, wpm)));

function BookCard({ book, wpm, onOpenChapter, onRemoveBookmark, onDelete }) {
    const progress = bookProgress(book);
    const next = nextChapterIndex(book);
    const nextChapter = book.chapters[next];
    const finished = Boolean(book.completedAt);

    return (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 md:p-5">
            <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <BookOpen size={16} className="text-purple-400 shrink-0" />
                        <h3 className="font-bold text-white truncate">{book.title}</h3>
                        {finished && <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 px-1.5 py-0.5 rounded">Finished</span>}
                    </div>
                    <div className="text-xs text-slate-500 mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                        <span>{progress.done} of {progress.total} chapters</span>
                        <span>{book.words.toLocaleString()} words</span>
                        <span>about {minutes(book.words - progress.wordsRead, wpm)} min left at {wpm} WPM</span>
                        {book.bookmarks.length > 0 && <span>{book.bookmarks.length} bookmark{book.bookmarks.length === 1 ? '' : 's'}</span>}
                    </div>
                    <div className="mt-3 h-1.5 bg-slate-800 rounded-full overflow-hidden" role="progressbar" aria-valuenow={progress.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${book.title} progress`}>
                        <div className="h-full bg-purple-500" style={{ width: `${progress.pct}%` }} />
                    </div>
                </div>
                <div className="flex gap-2 shrink-0">
                    <button
                        onClick={() => onOpenChapter(book.id, finished ? 0 : next)}
                        className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors flex items-center gap-2 max-w-[16rem]"
                    >
                        <Play size={14} className="fill-current shrink-0" />
                        <span className="truncate">{finished ? 'Read again' : book.lastReadAt ? `Continue: ${nextChapter?.title ?? ''}` : 'Start reading'}</span>
                    </button>
                    <button onClick={() => onDelete(book.id)} aria-label={`Delete ${book.title}`} className="text-slate-600 hover:text-red-400 px-2 transition-colors">
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>

            <details className="group mt-3">
                <summary className="cursor-pointer select-none text-xs font-bold text-slate-400 hover:text-white flex items-center gap-1">
                    <ChevronRight size={13} className="group-open:rotate-90 transition-transform" /> Chapters
                </summary>
                <ol className="mt-2 space-y-1 max-h-72 overflow-y-auto pr-1">
                    {book.chapters.map((ch, i) => {
                        const started = !ch.completedAt && ch.progressIndex > 0;
                        return (
                            <li key={i}>
                                <button
                                    onClick={() => onOpenChapter(book.id, i)}
                                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm transition-colors hover:bg-slate-800/70 ${i === next && !finished ? 'bg-purple-500/10' : ''}`}
                                >
                                    <span className="w-5 shrink-0 text-center">
                                        {ch.completedAt ? <Check size={14} className="text-emerald-400 inline" /> : <span className="text-[11px] text-slate-600 font-mono">{i + 1}</span>}
                                    </span>
                                    <span className={`flex-1 truncate ${ch.completedAt ? 'text-slate-500' : 'text-slate-200'}`}>{ch.title}</span>
                                    <span className="text-[11px] text-slate-500 font-mono shrink-0">
                                        {started ? `${Math.round((ch.progressIndex / ch.words) * 100)}% · ` : ''}{minutes(ch.words, wpm)}m
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ol>
            </details>

            {book.bookmarks.length > 0 && (
                <details className="group mt-2">
                    <summary className="cursor-pointer select-none text-xs font-bold text-slate-400 hover:text-white flex items-center gap-1">
                        <ChevronRight size={13} className="group-open:rotate-90 transition-transform" /> Bookmarks
                    </summary>
                    <ul className="mt-2 space-y-1">
                        {book.bookmarks.map(bm => (
                            <li key={bm.id} className="flex items-center gap-2">
                                <button
                                    onClick={() => onOpenChapter(book.id, bm.chapter, bm.index)}
                                    className="flex-1 min-w-0 flex items-start gap-2 px-3 py-2 rounded-lg text-left hover:bg-slate-800/70 transition-colors"
                                >
                                    <Bookmark size={13} className="text-amber-400 mt-0.5 shrink-0" />
                                    <span className="min-w-0">
                                        <span className="block text-xs text-slate-400">{book.chapters[bm.chapter]?.title} · {bm.createdAt}</span>
                                        <span className="block text-sm text-slate-200 truncate">{bm.snippet}</span>
                                    </span>
                                </button>
                                <button onClick={() => onRemoveBookmark(book.id, bm.id)} aria-label="Remove bookmark" className="p-1.5 text-slate-600 hover:text-red-400">
                                    <X size={14} />
                                </button>
                            </li>
                        ))}
                    </ul>
                </details>
            )}
        </div>
    );
}

/** Imported books, with per-chapter progress and bookmarks. */
export default function BookShelf({ books, wpm, onOpenChapter, onRemoveBookmark, onDelete }) {
    if (books.length === 0) return null;
    return (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-7">
            <div className="flex items-start gap-4 mb-5">
                <div className="shrink-0 w-9 h-9 rounded-xl bg-slate-800 grid place-items-center text-slate-400"><BookOpen size={18} /></div>
                <div>
                    <h2 className="text-xl font-bold text-white">Your books</h2>
                    <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">
                        One chapter per sitting. Leaving mid-chapter saves your place, and <strong className="text-slate-300">B</strong> in the
                        reader drops a bookmark you can jump back to.
                    </p>
                </div>
            </div>
            <div className="space-y-3">
                {books.map(book => (
                    <BookCard key={book.id} book={book} wpm={wpm} onOpenChapter={onOpenChapter} onRemoveBookmark={onRemoveBookmark} onDelete={onDelete} />
                ))}
            </div>
        </div>
    );
}
