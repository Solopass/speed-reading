// The Free books shelf: a catalog of public-domain EPUBs (from Standard Ebooks)
// published in the speed-reading-library repo on GitHub Pages. The catalog and
// books are fetched straight from there; nothing goes through a server of ours.

/** Where the catalog lives. A local copy can be used in development (`bun run serve` in that repo). */
export const CATALOG_URL = import.meta.env?.VITE_FREE_BOOKS_URL || 'https://solopass.github.io/speed-reading-library/catalog.json';

/** A real catalog is about 25 KB; a book about 1 MB. Anything far bigger is refused. */
export const MAX_CATALOG_BYTES = 1_000_000;
export const MAX_BOOK_BYTES = 15_000_000;
const MAX_BOOKS = 500;

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const BOOK_FILE_RE = /^books\/[A-Za-z0-9._-]+\.epub$/;

/** Checks and tidies a catalog; returns null when it is not one. Unknown fields are dropped. */
export function normalizeCatalog(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.books)) return null;
    const categories = (Array.isArray(raw.categories) ? raw.categories : [])
        .map(c => ({ id: str(c?.id, 40), label: str(c?.label, 60) }))
        .filter(c => c.id && c.label);
    const known = new Set(categories.map(c => c.id));
    const seen = new Set();
    const books = raw.books.slice(0, MAX_BOOKS).map(b => {
        const id = str(b?.id, 160);
        const file = str(b?.file, 200);
        const words = Number(b?.words);
        const bytes = Number(b?.bytes);
        if (!id || seen.has(id) || !BOOK_FILE_RE.test(file) || file.includes('..')) return null;
        if (!Number.isFinite(words) || words <= 0 || !Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_BOOK_BYTES) return null;
        const title = str(b?.title, 200);
        if (!title) return null;
        seen.add(id);
        const ease = Number(b?.readingEase);
        const source = str(b?.source, 300);
        return {
            id,
            title,
            author: str(b?.author, 200),
            ...(str(b?.translator, 200) ? { translator: str(b.translator, 200) } : {}),
            category: known.has(b?.category) ? b.category : 'other',
            words: Math.round(words),
            readingEase: Number.isFinite(ease) ? Math.round(ease) : null,
            description: str(b?.description, 600),
            file,
            bytes: Math.round(bytes),
            // Only a link back to Standard Ebooks is shown as the source.
            source: /^https:\/\/standardebooks\.org\//.test(source) ? source : ''
        };
    }).filter(Boolean);
    if (!books.length) return null;
    if (books.some(b => b.category === 'other') && !known.has('other')) categories.push({ id: 'other', label: 'Other' });
    return { name: str(raw.name, 120) || 'Free books', about: str(raw.about, 800), updated: str(raw.updated, 20), categories, books };
}

/** The address of a book's file, which must sit beside the catalog. */
export function bookUrl(book, catalogUrl = CATALOG_URL) {
    const base = new URL('.', catalogUrl);
    const url = new URL(book.file, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('That book is not part of the catalog.');
    return url.href;
}

/** Reads a response body, refusing it past `limit` bytes; reports progress as a fraction when the size is known. */
async function readCapped(response, limit, onProgress, expected = 0) {
    const declared = Number(response.headers.get('content-length')) || 0;
    if (declared > limit) throw new Error('That download is too large.');
    const total = declared || expected;
    if (!response.body?.getReader) {
        const buf = new Uint8Array(await response.arrayBuffer());
        if (buf.length > limit) throw new Error('That download is too large.');
        return buf;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
            await reader.cancel().catch(() => {});
            throw new Error('That download is too large.');
        }
        chunks.push(value);
        if (total && onProgress) onProgress(Math.min(1, size / total));
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
}

const offlineMessage = 'Could not reach the free books shelf. Check your connection and try again.';

/** Fetches and checks the catalog; throws a readable error. */
export async function fetchCatalog({ url = CATALOG_URL, fetchImpl = fetch, signal } = {}) {
    let response;
    try {
        response = await fetchImpl(url, { signal, cache: 'no-cache' });
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw new Error(offlineMessage);
    }
    if (!response.ok) throw new Error(`The free books shelf is not available right now (error ${response.status}).`);
    const bytes = await readCapped(response, MAX_CATALOG_BYTES);
    let parsed;
    try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('The free books list is damaged.'); }
    const catalog = normalizeCatalog(parsed);
    if (!catalog) throw new Error('The free books list is damaged.');
    return catalog;
}

/** Downloads one book as a File ready for the importer. `onProgress(0..1)`. */
export async function fetchBookFile(book, { catalogUrl = CATALOG_URL, fetchImpl = fetch, signal, onProgress } = {}) {
    let response;
    try {
        response = await fetchImpl(bookUrl(book, catalogUrl), { signal });
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw new Error(offlineMessage);
    }
    if (!response.ok) throw new Error(`Could not download "${book.title}" (error ${response.status}).`);
    const bytes = await readCapped(response, Math.min(MAX_BOOK_BYTES, Math.max(book.bytes * 2, 1_000_000)), onProgress, book.bytes);
    return new File([bytes], `${book.id}.epub`, { type: 'application/epub+zip' });
}

// --- Browsing the shelf -------------------------------------------------------

export const BOOK_LENGTHS = [
    { id: 'short', label: 'Short', note: 'under 50,000 words', max: 50_000 },
    { id: 'medium', label: 'Medium', note: '50,000–120,000 words', max: 120_000 },
    { id: 'long', label: 'Long', note: 'over 120,000 words', max: Infinity }
];

export const lengthOf = (words) => BOOK_LENGTHS.find(l => words < l.max)?.id ?? 'long';

/** Flesch reading ease as a plain label: 75+ reads easily, under 60 takes more effort. */
export function levelOf(readingEase) {
    if (readingEase == null) return null;
    if (readingEase >= 75) return 'Easy';
    if (readingEase >= 60) return 'Standard';
    return 'Demanding';
}

/** "about 3 h 20 min" at a reading speed. */
export function readingTime(words, wpm) {
    const minutes = Math.max(1, Math.round(words / Math.max(50, Number(wpm) || 250)));
    if (minutes < 60) return `about ${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = Math.round((minutes % 60) / 10) * 10;
    return m === 0 || m === 60 ? `about ${m === 60 ? h + 1 : h} h` : `about ${h} h ${m} min`;
}

export const FREE_BOOK_SORTS = [
    { id: 'shelf', label: 'Shelf order' },
    { id: 'shortest', label: 'Shortest first' },
    { id: 'easiest', label: 'Easiest first' },
    { id: 'title', label: 'Title' }
];

/** Books matching a search (title, author, description), a category and a length, in a sort order. */
export function findFreeBooks(books, { query = '', category = 'all', length = 'all', sort = 'shelf' } = {}) {
    const q = query.trim().toLowerCase();
    const shown = books.filter(b =>
        (category === 'all' || b.category === category)
        && (length === 'all' || lengthOf(b.words) === length)
        && (!q || `${b.title} ${b.author} ${b.translator ?? ''} ${b.description}`.toLowerCase().includes(q)));
    const by = {
        shortest: (a, b) => a.words - b.words,
        easiest: (a, b) => (b.readingEase ?? -999) - (a.readingEase ?? -999),
        title: (a, b) => a.title.localeCompare(b.title)
    };
    return by[sort] ? [...shown].sort(by[sort]) : shown;
}

const titleKey = (t) => String(t ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The library entry made from this free book, if there is one. By id only: two books can share a title ("Essays"). */
export const libraryCopyOf = (book, library = []) => library.find(item => item?.freeBookId === book.id) ?? null;

/**
 * The name a free book gets in the library: its title, with the author added
 * when another book on the shelf has the same title ("Essays (Ralph Waldo Emerson)").
 */
export function libraryTitleOf(book, books = []) {
    const same = books.filter(b => titleKey(b.title) === titleKey(book.title)).length;
    return same > 1 && book.author ? `${book.title} (${book.author})` : book.title;
}
