import { chapterSpeeds, mergeWithNext, renameChapter, splitChapterAt } from './book';
import { describe, expect, it } from 'vitest';
import {
    MAX_CHAPTER_WORDS, MIN_CHAPTER_WORDS, addBookmark, bookProgress, buildChapters, chapterPassage, chunkParagraphs,
    completeChapter, createBook, isHeading, migrateBook, nextChapterIndex, recordChapterProgress, removeBookmark,
    snippetAt, splitOnHeadings
} from './book';

const words = (n, w = 'word') => Array.from({ length: n }, () => w).join(' ');
const para = (n) => words(n);

describe('chapter detection', () => {
    it('recognises common heading shapes', () => {
        expect(isHeading('Chapter 3')).toBe(true);
        expect(isHeading('CHAPTER IV. The Storm')).toBe(true);
        expect(isHeading('XII')).toBe(true);
        expect(isHeading('## Results')).toBe(true);
        expect(isHeading('Prologue')).toBe(true);
        expect(isHeading('The chapter was long and the night was longer still, as nights go.')).toBe(false);
        expect(isHeading(para(30))).toBe(false);
    });

    it('splits on headings and keeps text before the first one', () => {
        const text = [para(50), 'Chapter 1', para(300), 'Chapter 2', para(300)].join('\n\n');
        const chapters = splitOnHeadings(text);
        expect(chapters.map(c => c.title)).toEqual(['Opening', 'Chapter 1', 'Chapter 2']);
    });

    it('returns null without enough headings', () => {
        expect(splitOnHeadings([para(100), para(100)].join('\n\n'))).toBeNull();
    });

    it('chunks heading-less text into parts at paragraph breaks', () => {
        const paragraphs = Array.from({ length: 20 }, () => para(300));
        const parts = chunkParagraphs(paragraphs, 2500);
        expect(parts).toHaveLength(2);
        expect(parts[0].title).toBe('Part 1');
        expect(parts[0].text.split(/\s+/)).toHaveLength(2700);
    });
});

describe('buildChapters', () => {
    it('keeps a full chapter’s name when a dedication and preface fold into it', () => {
        const chapters = buildChapters({
            text: '',
            chapters: [{ title: 'Dedication', text: words(5) }, { title: 'Preface', text: words(70) }, { title: 'I', text: words(400) }, { title: 'II', text: words(400) }]
        });
        expect(chapters.map(c => c.title)).toEqual(['I', 'II']);
    });

    it('names a short chapter by the longer front matter merged into it', () => {
        const chapters = buildChapters({
            text: '',
            chapters: [{ title: 'Part One', text: words(120) }, { title: 'Opening', text: words(150) }, { title: 'Next', text: words(400) }]
        });
        expect(chapters[0].title).toBe('Part One');
    });

    it('uses file chapters, merging tiny front matter forward', () => {
        const chapters = buildChapters({
            text: '',
            chapters: [{ title: 'Cover', text: words(5) }, { title: 'One', text: words(400) }, { title: 'Two', text: words(400) }]
        });
        expect(chapters).toHaveLength(2);
        expect(chapters[0].title).toBe('One');
        expect(chapters[0].text.split(/\s+/)).toHaveLength(405);
    });

    it('splits a very long chapter into parts', () => {
        const big = Array.from({ length: 40 }, () => para(300)).join('\n\n');
        const chapters = buildChapters({ text: '', chapters: [{ title: 'Huge', text: big }, { title: 'Small', text: words(MIN_CHAPTER_WORDS) }] });
        expect(chapters.length).toBeGreaterThan(2);
        expect(chapters[0].title).toBe('Huge (1)');
        chapters.forEach(c => expect(c.text.split(/\s+/).length).toBeLessThanOrEqual(MAX_CHAPTER_WORDS));
    });

    it('falls back to headings, then to parts', () => {
        const withHeadings = ['Chapter 1', para(300), 'Chapter 2', para(300)].join('\n\n');
        expect(buildChapters({ text: withHeadings }).map(c => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
        const plain = Array.from({ length: 12 }, () => para(500)).join('\n\n');
        expect(buildChapters({ text: plain })[0].title).toBe('Part 1');
    });
});

describe('book progress and bookmarks', () => {
    const make = () => createBook({ id: 'b1', title: 'Novel', chapters: [{ title: 'A', text: words(300) }, { title: 'B', text: words(300) }, { title: 'C', text: words(400) }] });

    it('creates a book with per-chapter state', () => {
        const book = make();
        expect(book.words).toBe(1000);
        expect(book.chapters[0]).toMatchObject({ words: 300, progressIndex: 0, completedAt: null });
        expect(bookProgress(book)).toMatchObject({ done: 0, total: 3, pct: 0 });
    });

    it('records progress, completes chapters and moves to the next', () => {
        let items = [make()];
        items = recordChapterProgress(items, 'b1', 0, 150);
        expect(bookProgress(items[0]).pct).toBe(15);
        expect(chapterPassage(items[0], 0).resumeFrom).toBe(150);
        items = completeChapter(items, 'b1', 0, { wpm: 400 });
        expect(items[0].chapters[0].completedAt).not.toBeNull();
        expect(items[0].chapters[0].progressIndex).toBe(0);
        expect(nextChapterIndex(items[0])).toBe(1);
        expect(bookProgress(items[0])).toMatchObject({ done: 1, pct: 30 });
        items = completeChapter(items, 'b1', 2);
        expect(nextChapterIndex(items[0])).toBe(1);
        items = completeChapter(items, 'b1', 1);
        expect(items[0].completedAt).not.toBeNull();
    });

    it('chapter passages carry the book and chapter', () => {
        const p = chapterPassage(make(), 2, 10);
        expect(p).toMatchObject({ id: 'b1', bookId: 'b1', chapterIndex: 2, title: 'Novel · C', resumeFrom: 10 });
    });

    it('adds and removes bookmarks, replacing near-duplicates', () => {
        let items = [make()];
        items = addBookmark(items, 'b1', { chapter: 1, index: 40, snippet: 'here' });
        items = addBookmark(items, 'b1', { chapter: 1, index: 42, snippet: 'here again' });
        expect(items[0].bookmarks).toHaveLength(1);
        expect(items[0].bookmarks[0].snippet).toBe('here again');
        items = removeBookmark(items, 'b1', items[0].bookmarks[0].id);
        expect(items[0].bookmarks).toHaveLength(0);
    });

    it('snippetAt gives a short excerpt', () => {
        expect(snippetAt('a b c d e', 1, 2)).toBe('b c…');
        expect(snippetAt('a b c', 1, 5)).toBe('b c');
    });

    it('migrateBook repairs bad fields and rejects empty books', () => {
        const fixed = migrateBook({ id: 'b2', title: 'X', chapters: [{ text: words(10), progressIndex: 99 }, null], currentChapter: 7, bookmarks: [{ chapter: 5, index: 1 }, { chapter: 0, index: 2 }] });
        expect(fixed.chapters).toHaveLength(1);
        expect(fixed.chapters[0].progressIndex).toBe(10);
        expect(fixed.currentChapter).toBe(0);
        expect(fixed.bookmarks).toHaveLength(1);
        expect(migrateBook({ chapters: [] })).toBeNull();
    });
});

describe('review fixes', () => {
    const make = () => createBook({ id: 'b1', title: 'Novel', chapters: [{ title: 'A', text: words(300) }, { title: 'B', text: words(300) }] });

    it('pacer progress never moves a saved place backwards; RSVP can', () => {
        let items = recordChapterProgress([make()], 'b1', 0, 200, { allowBackward: true });
        items = recordChapterProgress(items, 'b1', 0, 0);
        expect(items[0].chapters[0].progressIndex).toBe(200);
        items = recordChapterProgress(items, 'b1', 0, 50, { allowBackward: true });
        expect(items[0].chapters[0].progressIndex).toBe(50);
    });

    it('browsing a finished chapter does not change the next chapter', () => {
        let items = completeChapter([make()], 'b1', 0);
        expect(items[0].currentChapter).toBe(1);
        items = recordChapterProgress(items, 'b1', 0, 10);
        expect(items[0].currentChapter).toBe(1);
    });

    it('migration remaps bookmarks and the current chapter past dropped chapters', () => {
        const fixed = migrateBook({
            id: 'b', title: 'T', currentChapter: 2,
            chapters: [{ title: 'A', text: words(10) }, { title: 'empty', text: '  ' }, { title: 'C', text: words(10) }],
            bookmarks: [{ chapter: 2, index: 500 }, { chapter: 1, index: 0 }]
        });
        expect(fixed.chapters.map(c => c.title)).toEqual(['A', 'C']);
        expect(fixed.currentChapter).toBe(1);
        expect(fixed.bookmarks).toHaveLength(1);
        expect(fixed.bookmarks[0]).toMatchObject({ chapter: 1, index: 9 });
    });
});

describe('editing chapters before saving', () => {
    const chapters = [{ title: 'A', text: 'a1\n\na2\n\na3' }, { title: 'B', text: 'b1' }, { title: 'C', text: 'c1' }];

    it('renames, merges and splits', () => {
        expect(renameChapter(chapters, 1, 'Bee')[1].title).toBe('Bee');
        expect(mergeWithNext(chapters, 1)).toEqual([chapters[0], { title: 'B', text: 'b1\n\nc1' }]);
        expect(mergeWithNext(chapters, 2)).toBe(chapters);
        const split = splitChapterAt(chapters, 0, 2);
        expect(split.map(c => c.title)).toEqual(['A', 'A (continued)', 'B', 'C']);
        expect(split[0].text).toBe('a1\n\na2');
        expect(split[1].text).toBe('a3');
        expect(splitChapterAt(chapters, 0, 0)).toBe(chapters);
    });
});

describe('chapterSpeeds', () => {
    it('takes the latest finished attempt per chapter, in chapter order', () => {
        const book = {
            chapters: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
            attempts: [
                { kind: 'chapter', chapter: 1, wpm: 300, score: 80 },
                { kind: 'chapter', chapter: 0, wpm: 250, score: null },
                { kind: 'chapter', chapter: 1, wpm: 340.4, score: 90 },
                { kind: 'read', wpm: 999 }
            ]
        };
        expect(chapterSpeeds(book)).toEqual([
            { chapter: 0, title: 'A', wpm: 250, score: null },
            { chapter: 1, title: 'B', wpm: 340, score: 90 }
        ]);
    });
});
