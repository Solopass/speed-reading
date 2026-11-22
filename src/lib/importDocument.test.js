import { describe, expect, it } from 'vitest';
import { documentFromExtract, newDocumentId } from './importDocument';
import { BOOK_MIN_WORDS } from './book';

const words = (n, w = 'word') => Array.from({ length: n }, () => w).join(' ');

describe('documentFromExtract', () => {
    it('makes a passage from short text', () => {
        const doc = documentFromExtract({ title: 'Note', text: words(300), chapters: null });
        expect(doc.kind).toBe('passage');
        expect(doc.item).toMatchObject({ title: 'Note', questions: [] });
        expect(doc.item.text.split(' ')).toHaveLength(300);
    });

    it('makes a book from a file with its own chapters', () => {
        const doc = documentFromExtract({
            title: 'Novel', text: words(800),
            chapters: [{ title: 'I', text: words(400) }, { title: 'II', text: words(400) }]
        });
        expect(doc.kind).toBe('book');
        expect(doc.item.chapters.map(c => c.title)).toEqual(['I', 'II']);
        expect(doc.item.title).toBe('Novel');
    });

    it('makes a book from long text without chapters, split into parts', () => {
        const para = `${words(150)}.`;
        const text = Array.from({ length: Math.ceil((BOOK_MIN_WORDS * 2) / 150) }, () => para).join('\n\n');
        const doc = documentFromExtract({ title: 'Long', text, chapters: null });
        expect(doc.kind).toBe('book');
        expect(doc.item.chapters.length).toBeGreaterThanOrEqual(2);
    });

    it('falls back to a passage when the chapters merge into one', () => {
        const doc = documentFromExtract({
            title: 'Tiny', text: words(60),
            chapters: [{ title: 'A', text: words(30) }, { title: 'B', text: words(30) }]
        });
        expect(doc.kind).toBe('passage');
    });

    it('names an untitled document', () => {
        expect(documentFromExtract({ title: '  ', text: words(20) }).item.title).toBe('Imported document');
    });
});

describe('newDocumentId', () => {
    it('never repeats, even within one millisecond', () => {
        const ids = new Set(Array.from({ length: 50 }, () => newDocumentId('custom')));
        expect(ids.size).toBe(50);
    });
});
