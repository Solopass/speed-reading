import { describe, expect, it } from 'vitest';
import {
    MAX_CATALOG_BYTES, bookUrl, fetchBookFile, fetchCatalog, findFreeBooks, lengthOf, levelOf, libraryCopyOf,
    libraryTitleOf, normalizeCatalog, readingTime
} from './freeBooks';
import { migrateLibrary } from './library';
import { createBook } from './book';

const BASE = 'https://example.test/speed-reading-library/catalog.json';
const book = (over = {}) => ({
    id: 'henry-david-thoreau_walden', title: 'Walden', author: 'Henry David Thoreau', category: 'nonfiction',
    words: 106873, readingEase: 62, description: 'A life in the woods.', file: 'books/henry-david-thoreau_walden.epub',
    bytes: 997166, source: 'https://standardebooks.org/ebooks/henry-david-thoreau/walden', ...over
});
const catalog = (books = [book()]) => ({
    version: 1, name: 'Free', categories: [{ id: 'nonfiction', label: 'Non-fiction' }, { id: 'novels', label: 'Novels' }], books
});

describe('normalizeCatalog', () => {
    it('keeps valid books and drops unknown fields', () => {
        const c = normalizeCatalog({ ...catalog([{ ...book(), extra: 'x' }]) });
        expect(c.books).toHaveLength(1);
        expect(c.books[0]).not.toHaveProperty('extra');
        expect(c.books[0].title).toBe('Walden');
    });

    it('refuses books whose file points elsewhere, is huge, or repeats an id', () => {
        const c = normalizeCatalog(catalog([
            book(),
            book({ id: 'a', file: '../evil.epub' }),
            book({ id: 'b', file: 'https://evil.test/x.epub' }),
            book({ id: 'c', file: 'books/../../x.epub' }),
            book({ id: 'd', bytes: 50_000_000 }),
            book({ id: 'e', words: -1 }),
            book({ id: 'f', title: '' }),
            book()
        ]));
        expect(c.books.map(b => b.id)).toEqual(['henry-david-thoreau_walden']);
    });

    it('puts unknown categories under Other and keeps only Standard Ebooks source links', () => {
        const c = normalizeCatalog(catalog([book({ category: 'poetry', source: 'javascript:alert(1)' })]));
        expect(c.books[0].category).toBe('other');
        expect(c.books[0].source).toBe('');
        expect(c.categories.at(-1)).toEqual({ id: 'other', label: 'Other' });
    });

    it('returns null for anything that is not a catalog', () => {
        expect(normalizeCatalog(null)).toBeNull();
        expect(normalizeCatalog({ books: 'no' })).toBeNull();
        expect(normalizeCatalog({ books: [{ id: 'x' }] })).toBeNull();
    });
});

describe('bookUrl', () => {
    it('resolves beside the catalog', () => {
        expect(bookUrl(book(), BASE)).toBe('https://example.test/speed-reading-library/books/henry-david-thoreau_walden.epub');
    });
});

const respond = (body, init = {}) => async () => new Response(body, init);

describe('fetchCatalog', () => {
    it('fetches and checks the catalog', async () => {
        const c = await fetchCatalog({ url: BASE, fetchImpl: respond(JSON.stringify(catalog())) });
        expect(c.books[0].id).toBe('henry-david-thoreau_walden');
    });

    it('explains being offline, a missing shelf and a damaged list', async () => {
        await expect(fetchCatalog({ url: BASE, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } })).rejects.toThrow(/connection/);
        await expect(fetchCatalog({ url: BASE, fetchImpl: respond('nope', { status: 404 }) })).rejects.toThrow(/404/);
        await expect(fetchCatalog({ url: BASE, fetchImpl: respond('{not json') })).rejects.toThrow(/damaged/);
    });

    it('refuses an oversized catalog', async () => {
        const big = 'x'.repeat(MAX_CATALOG_BYTES + 10);
        await expect(fetchCatalog({ url: BASE, fetchImpl: respond(big) })).rejects.toThrow(/too large/);
    });
});

describe('fetchBookFile', () => {
    it('downloads a book as an EPUB file and reports progress', async () => {
        const bytes = new Uint8Array(2000).fill(7);
        const seen = [];
        const file = await fetchBookFile(book({ bytes: 2000 }), { catalogUrl: BASE, fetchImpl: respond(bytes), onProgress: p => seen.push(p) });
        expect(file.name).toBe('henry-david-thoreau_walden.epub');
        expect(file.size).toBe(2000);
        expect(seen.at(-1)).toBe(1);
    });

    it('stops a download that grows far past its listed size', async () => {
        const huge = new Uint8Array(3_000_000);
        await expect(fetchBookFile(book({ bytes: 1000 }), { catalogUrl: BASE, fetchImpl: respond(huge) })).rejects.toThrow(/too large/);
    });
});

describe('shelf helpers', () => {
    const books = [
        book(),
        book({ id: 'jekyll', title: 'The Strange Case of Dr. Jekyll and Mr. Hyde', author: 'Robert Louis Stevenson', category: 'novels', words: 25693, readingEase: 70 }),
        book({ id: 'moby', title: 'Moby Dick', author: 'Herman Melville', category: 'novels', words: 211694, readingEase: 64 })
    ];

    it('labels length, level and reading time', () => {
        expect([lengthOf(25693), lengthOf(106873), lengthOf(211694)]).toEqual(['short', 'medium', 'long']);
        expect([levelOf(80), levelOf(64), levelOf(40), levelOf(null)]).toEqual(['Easy', 'Standard', 'Demanding', null]);
        expect(readingTime(25693, 300)).toBe('about 1 h 30 min');
        expect(readingTime(5000, 400)).toBe('about 13 min');
        expect(readingTime(36000, 300)).toBe('about 2 h');
    });

    it('searches, filters and sorts', () => {
        expect(findFreeBooks(books, { query: 'melville' }).map(b => b.id)).toEqual(['moby']);
        expect(findFreeBooks(books, { category: 'novels', length: 'short' }).map(b => b.id)).toEqual(['jekyll']);
        expect(findFreeBooks(books, { sort: 'shortest' }).map(b => b.id)).toEqual(['jekyll', 'henry-david-thoreau_walden', 'moby']);
        expect(findFreeBooks(books, { sort: 'easiest' })[0].id).toBe('jekyll');
    });

    it('finds the library copy by id, and adds the author to shared titles', () => {
        expect(libraryCopyOf(books[0], [{ id: 'b1', kind: 'book', title: 'Walden', freeBookId: 'other' }])).toBeNull();
        expect(libraryCopyOf(books[0], [{ id: 'b1', freeBookId: 'henry-david-thoreau_walden' }])?.id).toBe('b1');
        const essays = [book({ id: 'e1', title: 'Essays', author: 'Ralph Waldo Emerson' }), book({ id: 'e2', title: 'Essays', author: 'Thomas Paine' })];
        expect(libraryTitleOf(essays[0], essays)).toBe('Essays (Ralph Waldo Emerson)');
        expect(libraryTitleOf(books[0], books)).toBe('Walden');
    });

    it('keeps a book’s free-book id through a library migration', () => {
        const words = (n) => Array.from({ length: n }, () => 'w').join(' ');
        const b = createBook({ id: 'b1', title: 'Walden', freeBookId: 'henry-david-thoreau_walden', chapters: [{ title: 'I', text: words(300) }, { title: 'II', text: words(300) }] });
        expect(migrateLibrary([b])[0].freeBookId).toBe('henry-david-thoreau_walden');
    });
});
