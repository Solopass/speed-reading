import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Check, ChevronDown, ExternalLink, Library as LibraryIcon, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import {
    BOOK_LENGTHS, FREE_BOOK_SORTS, fetchBookFile, fetchCatalog, findFreeBooks, lengthOf, levelOf, libraryCopyOf,
    libraryTitleOf, readingTime
} from '../lib/freeBooks';
import { importDocumentFile } from '../lib/importDocument';

// Shared by every mount of the shelf for this page visit: the catalog is fetched once (again
// only after a failure), and a book still downloading can't be added twice from a reopened shelf.
let catalogPromise = null;
const loadCatalogOnce = () => {
    catalogPromise ??= fetchCatalog().catch((error) => { catalogPromise = null; throw error; });
    return catalogPromise;
};
const inFlight = new Set();

const LEVEL_STYLES = {
    Easy: 'text-emerald-300 border-emerald-500/40',
    Standard: 'text-sky-300 border-sky-500/40',
    Demanding: 'text-amber-300 border-amber-500/40'
};

const chip = (active) => `px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${active
    ? 'border-purple-500 bg-purple-500/15 text-purple-200'
    : 'border-slate-700 text-slate-400 hover:border-slate-500'}`;

function FreeBookCard({ book, categoryLabel, wpm, copy, progress, onAdd, onRead }) {
    const level = levelOf(book.readingEase);
    const length = BOOK_LENGTHS.find(l => l.id === lengthOf(book.words));
    const adding = progress != null;
    return (
        <li className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3">
            <div className="min-w-0">
                <h3 className="font-bold text-white leading-snug">{book.title}</h3>
                <p className="text-sm text-slate-400 mt-0.5">
                    {book.author}{book.translator ? <span className="text-slate-500"> · translated by {book.translator}</span> : null}
                </p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                <span className="px-2 py-0.5 rounded-md border border-slate-700 text-slate-300">{categoryLabel}</span>
                <span className="px-2 py-0.5 rounded-md border border-slate-700 text-slate-300" title={`${book.words.toLocaleString()} words`}>
                    {length.label} · {Math.round(book.words / 1000)}k words
                </span>
                {level && (
                    <span className={`px-2 py-0.5 rounded-md border ${LEVEL_STYLES[level]}`} title={`Reading ease ${book.readingEase} (higher is easier)`}>
                        {level}
                    </span>
                )}
                <span className="px-2 py-0.5 rounded-md border border-slate-700 text-slate-400">{readingTime(book.words, wpm)} at {wpm} WPM</span>
            </div>
            {book.description && <p className="text-sm text-slate-400 leading-relaxed line-clamp-3">{book.description}</p>}
            <div className="flex items-center gap-2 mt-auto pt-1">
                {copy ? (
                    <>
                        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-300"><Check size={15} /> Added</span>
                        <button
                            type="button" onClick={() => onRead(copy)}
                            className="ml-auto inline-flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold px-3.5 py-2 rounded-xl transition-colors"
                        >
                            <BookOpen size={15} /> Read
                        </button>
                    </>
                ) : (
                    <button
                        type="button" onClick={() => onAdd(book)} disabled={adding}
                        aria-label={adding ? `Adding ${book.title}` : `Add ${book.title} to your books`}
                        className="inline-flex items-center gap-1.5 border border-purple-500/60 hover:bg-purple-500/15 disabled:opacity-80 text-purple-200 text-sm font-bold px-3.5 py-2 rounded-xl transition-colors"
                    >
                        {adding
                            ? <><Loader2 size={15} className="animate-spin" /> {progress < 1 ? `Downloading ${Math.round(progress * 100)}%` : 'Setting up chapters…'}</>
                            : <><Plus size={15} /> Add to my books</>}
                    </button>
                )}
                {book.source && (
                    <a
                        href={book.source} target="_blank" rel="noopener noreferrer"
                        className={`${copy ? '' : 'ml-auto '}inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300`}
                        aria-label={`${book.title} on Standard Ebooks (opens in a new tab)`}
                    >
                        Standard Ebooks <ExternalLink size={12} />
                    </a>
                )}
            </div>
        </li>
    );
}

/**
 * The Free books shelf: public-domain classics from the speed-reading-library
 * repo. The list loads only when the shelf is opened.
 */
export default function FreeBooks({ library = [], readingWpm = 300, onSaveBook, onOpenBook, addNotification, defaultOpen = false, scrollIntoView = false }) {
    const [open, setOpen] = useState(defaultOpen);
    const [state, setState] = useState(() => ({ status: defaultOpen ? 'loading' : 'idle', catalog: null, error: '' }));
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('all');
    const [length, setLength] = useState('all');
    const [sort, setSort] = useState('shelf');
    const [adding, setAdding] = useState({});
    const sectionRef = useRef(null);

    // A reply that arrives after the shelf has gone (a new request remounts it) is dropped.
    const liveRef = useRef(true);
    useEffect(() => {
        liveRef.current = true;
        return () => { liveRef.current = false; };
    }, []);

    const load = useCallback(() => loadCatalogOnce().then(
        (catalog) => { if (liveRef.current) setState({ status: 'ready', catalog, error: '' }); },
        (error) => { if (liveRef.current) setState({ status: 'error', catalog: null, error: error.message || 'Could not load the free books.' }); }
    ), []);

    useEffect(() => {
        if (defaultOpen) load();
    }, [defaultOpen, load]);

    // Scrolled to once the list is in: while it loads, the page may be too short to scroll that far.
    const listReady = state.status !== 'loading';
    useEffect(() => {
        if (!scrollIntoView || !listReady) return;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        sectionRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }, [scrollIntoView, listReady]);

    const toggle = () => {
        const next = !open;
        setOpen(next);
        if (next && (state.status === 'idle' || state.status === 'error')) {
            setState(s => ({ ...s, status: 'loading', error: '' }));
            load();
        }
    };

    const retry = () => {
        setState(s => ({ ...s, status: 'loading', error: '' }));
        load();
    };

    const add = async (book) => {
        if (inFlight.has(book.id)) return;
        inFlight.add(book.id);
        const books = state.catalog?.books ?? [];
        setAdding(prev => ({ ...prev, [book.id]: 0 }));
        try {
            const file = await fetchBookFile(book, { onProgress: (p) => setAdding(prev => ({ ...prev, [book.id]: Math.min(p, 0.99) })) });
            setAdding(prev => ({ ...prev, [book.id]: 1 }));
            const doc = await importDocumentFile(file, { title: libraryTitleOf(book, books), freeBookId: book.id });
            if (doc.kind !== 'book') throw new Error('That book did not split into chapters.');
            onSaveBook(doc.item);
        } catch (error) {
            addNotification?.(`${book.title}: ${error.message || 'Could not add that book.'}`);
        } finally {
            inFlight.delete(book.id);
            setAdding(prev => {
                const next = { ...prev };
                delete next[book.id];
                return next;
            });
        }
    };

    const catalog = state.catalog;
    const shown = catalog ? findFreeBooks(catalog.books, { query, category, length, sort }) : [];
    const labelOf = (id) => catalog?.categories.find(c => c.id === id)?.label ?? 'Other';
    const addedCount = catalog ? catalog.books.filter(b => libraryCopyOf(b, library)).length : 0;

    return (
        <section ref={sectionRef} aria-labelledby="free-books-title" className="bg-slate-900 border border-slate-800 rounded-3xl scroll-mt-20 md:scroll-mt-4">
            <button
                type="button" onClick={toggle} aria-expanded={open} aria-controls="free-books-panel"
                className="w-full flex items-center gap-3 text-left p-5"
            >
                <span className="w-10 h-10 rounded-xl bg-slate-800 grid place-items-center text-purple-400 shrink-0"><LibraryIcon size={20} /></span>
                <span className="min-w-0 flex-1">
                    <span id="free-books-title" className="block text-xl font-bold text-white">Free books</span>
                    <span className="block text-sm text-slate-400 mt-0.5">
                        Public-domain classics, ready to speed read{catalog ? ` · ${catalog.books.length} books${addedCount ? `, ${addedCount} added` : ''}` : ''}
                    </span>
                </span>
                <ChevronDown size={20} className={`text-slate-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div id="free-books-panel" className="px-5 pb-5 space-y-4">
                    <p className="text-xs text-slate-500 leading-relaxed">
                        Carefully proofread editions from <a href="https://standardebooks.org" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-300">Standard Ebooks</a>,
                        free to use. They are in the public domain in the US; if you live elsewhere, check your country&rsquo;s rules first.
                    </p>

                    {state.status === 'loading' && (
                        <p className="flex items-center gap-2 text-sm text-slate-400 py-6 justify-center"><Loader2 size={16} className="animate-spin" /> Loading the shelf…</p>
                    )}

                    {state.status === 'error' && (
                        <div className="text-center py-6 space-y-3">
                            <p className="text-sm text-slate-300">{state.error}</p>
                            <button type="button" onClick={retry} className="inline-flex items-center gap-2 border border-slate-700 hover:border-slate-500 text-slate-200 text-sm font-bold px-3.5 py-2 rounded-xl">
                                <RefreshCw size={15} /> Try again
                            </button>
                        </div>
                    )}

                    {catalog && (
                        <>
                            <div className="space-y-2">
                                <div className="flex flex-wrap gap-2">
                                    <div className="relative flex-1 min-w-[12rem]">
                                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                                        <input
                                            type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                                            placeholder="Search title or author…" aria-label="Search free books"
                                            className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                                        />
                                    </div>
                                    <select value={length} onChange={(e) => setLength(e.target.value)} aria-label="Length"
                                        className="bg-slate-950 border border-slate-700 rounded-xl px-2 py-2 text-sm text-white">
                                        <option value="all">Any length</option>
                                        {BOOK_LENGTHS.map(l => <option key={l.id} value={l.id}>{l.label} ({l.note})</option>)}
                                    </select>
                                    <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort free books"
                                        className="bg-slate-950 border border-slate-700 rounded-xl px-2 py-2 text-sm text-white">
                                        {FREE_BOOK_SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                                    </select>
                                </div>
                                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category">
                                    {[{ id: 'all', label: 'All' }, ...catalog.categories].map(c => (
                                        <button key={c.id} type="button" role="radio" aria-checked={category === c.id} onClick={() => setCategory(c.id)} className={chip(category === c.id)}>
                                            {c.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {shown.length === 0 ? (
                                <p className="text-sm text-slate-500 text-center py-6">No books match. Try another search or filter.</p>
                            ) : (
                                <ul className="grid gap-3 sm:grid-cols-2" aria-label={`${shown.length} free books`}>
                                    {shown.map(book => (
                                        <FreeBookCard
                                            key={book.id}
                                            book={book}
                                            categoryLabel={labelOf(book.category)}
                                            wpm={readingWpm}
                                            copy={libraryCopyOf(book, library)}
                                            // A download started before the shelf was reopened still counts as running.
                                            progress={adding[book.id] ?? (inFlight.has(book.id) ? 0 : undefined)}
                                            onAdd={add}
                                            onRead={onOpenBook}
                                        />
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                </div>
            )}
        </section>
    );
}
