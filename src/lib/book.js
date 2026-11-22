import { todayKey } from './stats';

// Book mode: a long import split into chapters, read as a series of sessions
// with progress kept per chapter and bookmarks you can jump back to. A whole
// novel as one passage meant one enormous RSVP stream with a single resume
// point; this keeps each sitting a sensible length.

/** Imports at least this long are offered as a book rather than one passage. */
export const BOOK_MIN_WORDS = 3000;
/** Target length of a part when a text has no chapter headings to split on. */
export const PART_WORDS = 2500;
/** Chapters shorter than this (title pages, a table of contents) merge forward. */
export const MIN_CHAPTER_WORDS = 200;
/** Chapters longer than this are split into parts, so one sitting stays sensible. */
export const MAX_CHAPTER_WORDS = 8000;
export const MAX_BOOKMARKS = 50;

const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);
const paragraphsOf = (text) => text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

const HEADING = /^(chapter|part|book|section|prologue|epilogue|introduction|preface|foreword|afterword|appendix|interlude)\b/i;
const NUMERAL = /^(\d{1,3}|[ivxlcdm]{1,7})[.:]?$/i;

/** A short standalone paragraph that names a chapter. */
export function isHeading(paragraph) {
    const p = paragraph.replace(/^#+\s*/, '').trim();
    if (!p || p.length > 80 || countWords(p) > 10) return false;
    if (/^#{1,3}\s/.test(paragraph)) return true;
    return HEADING.test(p) || NUMERAL.test(p);
}

/** Groups paragraphs into parts of roughly `target` words, breaking only between paragraphs. */
export function chunkParagraphs(paragraphs, target = PART_WORDS, label = 'Part') {
    const parts = [];
    let current = [];
    let words = 0;
    for (const p of paragraphs) {
        current.push(p);
        words += countWords(p);
        if (words >= target) {
            parts.push(current);
            current = [];
            words = 0;
        }
    }
    if (current.length) {
        // A short tail joins the previous part rather than standing alone.
        if (parts.length && words < target / 3) parts[parts.length - 1].push(...current);
        else parts.push(current);
    }
    return parts.map((ps, i) => ({ title: `${label} ${i + 1}`, text: ps.join('\n\n') }));
}

/** Splits on chapter headings; null when the text does not have enough of them. */
export function splitOnHeadings(text) {
    const paragraphs = paragraphsOf(text);
    const chapters = [];
    let current = null;
    for (const p of paragraphs) {
        if (isHeading(p)) {
            if (current) chapters.push(current);
            current = { title: p.replace(/^#+\s*/, '').trim(), paragraphs: [] };
        } else {
            if (!current) current = { title: 'Opening', paragraphs: [] };
            current.paragraphs.push(p);
        }
    }
    if (current) chapters.push(current);
    const real = chapters.filter(c => c.paragraphs.length > 0);
    if (real.length < 2) return null;
    return real.map(c => ({ title: c.title, text: c.paragraphs.join('\n\n') }));
}

/**
 * Tidies chapters from any source: drops empty ones, merges tiny ones into the
 * next (front matter), and splits very long ones into parts.
 */
export function tidyChapters(chapters) {
    const merged = [];
    let carry = null;
    for (const ch of chapters) {
        const text = (carry ? `${carry.text}\n\n` : '') + ch.text.trim();
        // Short front matter folded into a chapter that stands on its own keeps that chapter's name
        // (a dedication must not rename chapter I); otherwise a carry of some length names the whole.
        const ownWords = countWords(ch.text);
        const title = carry && countWords(carry.text) >= 40 && ownWords < MIN_CHAPTER_WORDS ? carry.title : (ch.title || carry?.title);
        if (!text.trim()) continue;
        if (countWords(text) < MIN_CHAPTER_WORDS) { carry = { title, text }; continue; }
        merged.push({ title, text });
        carry = null;
    }
    if (carry) {
        if (merged.length) merged[merged.length - 1].text += `\n\n${carry.text}`;
        else merged.push(carry);
    }

    return merged.flatMap(ch => {
        if (countWords(ch.text) <= MAX_CHAPTER_WORDS) return [ch];
        return chunkParagraphs(paragraphsOf(ch.text), PART_WORDS)
            .map((part, i) => ({ title: `${ch.title} (${i + 1})`, text: part.text }));
    });
}

/**
 * Chapters for an imported text: the file's own chapters when it has them
 * (EPUB), headings found in the text otherwise, and even parts as a last resort.
 */
export function buildChapters({ text, chapters = null }) {
    const source = (chapters && chapters.length > 1)
        ? chapters.map((c, i) => ({ title: c.title || `Chapter ${i + 1}`, text: c.text }))
        : (splitOnHeadings(text) ?? chunkParagraphs(paragraphsOf(text), PART_WORDS));
    return tidyChapters(source).map((c, i) => ({ ...c, title: c.title || `Part ${i + 1}` }));
}

// --- Book entries -----------------------------------------------------------

export function createBook({ id, title, source = 'import', chapters }) {
    return {
        id: id ?? `b-${Date.now()}`,
        kind: 'book',
        title: title || 'Untitled book',
        source,
        text: null, sectionA: null, sectionB: null,
        questions: [], gistQuestions: [],
        chapters: chapters.map(c => ({
            title: c.title,
            text: c.text,
            words: countWords(c.text),
            progressIndex: 0,
            completedAt: null,
            questions: Array.isArray(c.questions) ? c.questions : [],
            gistQuestions: Array.isArray(c.gistQuestions) ? c.gistQuestions : []
        })),
        currentChapter: 0,
        bookmarks: [],
        words: chapters.reduce((sum, c) => sum + countWords(c.text), 0),
        createdAt: todayKey(),
        lastReadAt: null,
        progressIndex: 0,
        completedAt: null,
        attempts: []
    };
}

export const isBook = (item) => item?.kind === 'book' && Array.isArray(item.chapters);

/** Words read so far, counting finished chapters whole and the rest up to their resume point. */
export function bookProgress(book) {
    const read = book.chapters.reduce((sum, c) => sum + (c.completedAt ? c.words : Math.min(c.progressIndex, c.words)), 0);
    const done = book.chapters.filter(c => c.completedAt).length;
    return { done, total: book.chapters.length, wordsRead: read, pct: book.words ? Math.round((read / book.words) * 100) : 0 };
}

/** What the reader runs for one chapter. `resumeFrom` overrides the saved position (bookmarks). */
export function chapterPassage(book, index, resumeFrom = null) {
    const ch = book.chapters[index];
    return {
        id: book.id,
        bookId: book.id,
        chapterIndex: index,
        title: `${book.title} · ${ch.title}`,
        chapterTitle: ch.title,
        text: ch.text,
        questions: Array.isArray(ch.questions) ? ch.questions : [],
        gistQuestions: Array.isArray(ch.gistQuestions) ? ch.gistQuestions : [],
        resumeFrom: resumeFrom ?? (ch.progressIndex > 0 && ch.progressIndex < ch.words ? ch.progressIndex : 0)
    };
}

const updateBook = (items, id, fn) => items.map(item => (item.id === id && isBook(item) ? fn(item) : item));

const withChapter = (book, index, patch) => ({
    ...book,
    chapters: book.chapters.map((c, i) => (i === index ? { ...c, ...patch } : c))
});

/**
 * Saves where you stopped inside a chapter. Only an RSVP cursor (which starts
 * at the saved place and can be rewound) may move it backwards; the pacers
 * restart at word 0 on a mode switch, so for them the furthest point wins.
 * Browsing a finished chapter does not change which chapter is "next".
 */
export const recordChapterProgress = (items, id, index, progressIndex, { allowBackward = false } = {}) => updateBook(items, id, book => {
    const ch = book.chapters[index];
    if (!ch) return book;
    const at = Math.min(ch.words, Math.max(0, progressIndex));
    return {
        ...withChapter(book, index, { progressIndex: allowBackward ? at : Math.max(ch.progressIndex, at) }),
        currentChapter: ch.completedAt ? book.currentChapter : index,
        lastReadAt: todayKey()
    };
});

/** Marks a chapter finished and moves on to the next unfinished one. */
export function completeChapter(items, id, index, { wpm = null, score = null } = {}) {
    return updateBook(items, id, book => {
        const updated = withChapter(book, index, { completedAt: todayKey(), progressIndex: 0 });
        const next = updated.chapters.findIndex((c, i) => i > index && !c.completedAt);
        const firstOpen = updated.chapters.findIndex(c => !c.completedAt);
        const allDone = firstOpen === -1;
        return {
            ...updated,
            currentChapter: next !== -1 ? next : allDone ? index : firstOpen,
            completedAt: allDone ? (book.completedAt ?? todayKey()) : null,
            lastReadAt: todayKey(),
            attempts: [...book.attempts, { date: todayKey(), wpm, score, kind: 'chapter', chapter: index }]
        };
    });
}

/** The chapter to continue with. */
export const nextChapterIndex = (book) => Math.min(Math.max(0, book.currentChapter ?? 0), book.chapters.length - 1);

export function addBookmark(items, id, { chapter, index, snippet, note = '' }) {
    return updateBook(items, id, book => ({
        ...book,
        bookmarks: [
            {
                id: `bm-${Date.now()}`,
                chapter,
                index,
                snippet: String(snippet ?? '').slice(0, 120),
                note: String(note ?? '').trim().slice(0, 280),
                createdAt: todayKey()
            },
            ...book.bookmarks.filter(b => !(b.chapter === chapter && Math.abs(b.index - index) < 5))
        ].slice(0, MAX_BOOKMARKS)
    }));
}

export const removeBookmark = (items, id, bookmarkId) => updateBook(items, id, book => ({
    ...book, bookmarks: book.bookmarks.filter(b => b.id !== bookmarkId)
}));

/** A sentence-ish snippet starting at a word, for a bookmark's label. */
export function snippetAt(text, index, length = 14) {
    const words = text.trim().split(/\s+/);
    return words.slice(index, index + length).join(' ') + (index + length < words.length ? '…' : '');
}

/** Repairs a stored book; null if it is beyond saving. */
export function migrateBook(raw) {
    if (!raw || !Array.isArray(raw.chapters)) return null;
    // Old chapter number -> new, so bookmarks and the current chapter survive
    // any chapter dropped here for being empty.
    const remap = new Map();
    raw.chapters.forEach((c, i) => { if (c && typeof c.text === 'string' && c.text.trim()) remap.set(i, remap.size); });
    const chapters = raw.chapters
        .filter(c => c && typeof c.text === 'string' && c.text.trim())
        .map((c, i) => {
            const words = countWords(c.text);
            return {
                title: typeof c.title === 'string' && c.title ? c.title : `Part ${i + 1}`,
                text: c.text,
                words,
                progressIndex: Number.isInteger(c.progressIndex) ? Math.min(Math.max(0, c.progressIndex), words) : 0,
                completedAt: typeof c.completedAt === 'string' ? c.completedAt : null,
                questions: Array.isArray(c.questions) ? c.questions : [],
                gistQuestions: Array.isArray(c.gistQuestions) ? c.gistQuestions : []
            };
        });
    if (!chapters.length) return null;
    return {
        ...createBook({ id: raw.id, title: raw.title, source: raw.source ?? 'import', chapters }),
        chapters,
        currentChapter: remap.get(raw.currentChapter) ?? 0,
        bookmarks: Array.isArray(raw.bookmarks)
            ? raw.bookmarks
                .filter(b => b && remap.has(b.chapter) && Number.isInteger(b.index))
                .map(b => {
                    const chapter = remap.get(b.chapter);
                    return {
                        id: typeof b.id === 'string' ? b.id : `bm-${chapter}-${b.index}`,
                        chapter,
                        index: Math.min(Math.max(0, b.index), Math.max(0, chapters[chapter].words - 1)),
                        snippet: String(b.snippet ?? '').slice(0, 120),
                        note: typeof b.note === 'string' ? b.note.slice(0, 280) : '',
                        createdAt: typeof b.createdAt === 'string' ? b.createdAt : todayKey()
                    };
                })
                .slice(0, MAX_BOOKMARKS)
            : [],
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : todayKey(),
        lastReadAt: typeof raw.lastReadAt === 'string' ? raw.lastReadAt : null,
        completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
        attempts: Array.isArray(raw.attempts) ? raw.attempts.filter(a => a && typeof a.date === 'string') : []
    };
}

// --- Editing the chapter list before a book is saved ------------------------

/** Renames chapter `i`. */
export const renameChapter = (chapters, i, title) =>
    chapters.map((c, j) => (j === i ? { ...c, title: String(title).slice(0, 120) } : c));

/** Joins chapter `i` with the one after it, keeping the first title. */
export function mergeWithNext(chapters, i) {
    if (i < 0 || i >= chapters.length - 1) return chapters;
    const merged = { title: chapters[i].title, text: `${chapters[i].text.trim()}\n\n${chapters[i + 1].text.trim()}` };
    return [...chapters.slice(0, i), merged, ...chapters.slice(i + 2)];
}

/** Splits chapter `i` before its paragraph `at` (1 or later); the new chapter is titled after the old. */
export function splitChapterAt(chapters, i, at) {
    const paras = paragraphsOf(chapters[i]?.text ?? '');
    if (at < 1 || at >= paras.length) return chapters;
    const first = { title: chapters[i].title, text: paras.slice(0, at).join('\n\n') };
    const second = { title: `${chapters[i].title} (continued)`, text: paras.slice(at).join('\n\n') };
    return [...chapters.slice(0, i), first, second, ...chapters.slice(i + 1)];
}

/**
 * Measured speed per chapter, from the book's finished-chapter attempts (the
 * latest one per chapter). Returns [{ chapter, title, wpm, score }] in chapter order.
 */
export function chapterSpeeds(book) {
    const latest = new Map();
    for (const a of book?.attempts ?? []) {
        if (a?.kind === 'chapter' && Number.isInteger(a.chapter) && Number.isFinite(a.wpm) && a.wpm > 0) latest.set(a.chapter, a);
    }
    return [...latest.values()]
        .filter(a => book.chapters[a.chapter])
        .sort((x, y) => x.chapter - y.chapter)
        .map(a => ({ chapter: a.chapter, title: book.chapters[a.chapter].title, wpm: Math.round(a.wpm), score: Number.isFinite(a.score) ? a.score : null }));
}
