import { daysBetween, todayKey } from './stats';
import { isBook, migrateBook } from './book';

const MAX_ITEMS = 60;

/**
 * Spacing between retention re-tests, in days. Reading something quickly is
 * only worth anything if it is still there later, so a passage you completed
 * comes back to be re-quizzed on a widening schedule.
 */
export const RECALL_INTERVALS = [2, 7, 21, 60];

export const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;

export function createEntry({ id, title, source, kind = 'read', text, sectionA, sectionB, questions = [], gistQuestions = [] }) {
    return {
        id: id ?? `p-${Date.now()}`,
        title: title || 'Untitled passage',
        source,                       // 'ai' | 'import' | 'youtube' | 'builtin'
        kind,                         // 'read' (single text) | 'push' (two sections)
        text: text ?? null,
        sectionA: sectionA ?? null,
        sectionB: sectionB ?? null,
        questions,
        gistQuestions,               // optional, for skim mode
        words: wordCount(kind === 'push' ? `${sectionA} ${sectionB}` : (text ?? '')),
        createdAt: todayKey(),
        lastReadAt: null,
        progressIndex: 0,
        completedAt: null,
        bookmarks: [],
        attempts: []                  // { date, wpm, score, kind: 'read' | 'recall' }
    };
}

/**
 * Trims the library to MAX_ITEMS by dropping the oldest passages. Books are
 * never dropped this way: losing a whole imported book and its progress to make
 * room for a generated passage would be the wrong trade.
 */
function withoutOldest(items) {
    if (items.length <= MAX_ITEMS) return items;
    const removable = items.filter(i => !isBook(i)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const drop = new Set(removable.slice(0, items.length - MAX_ITEMS).map(i => i.id));
    return items.filter(i => !drop.has(i.id));
}

export function upsertEntry(items, entry) {
    const existing = items.findIndex(i => i.id === entry.id);
    if (existing === -1) return withoutOldest([entry, ...items]);
    const next = [...items];
    next[existing] = { ...next[existing], ...entry };
    return next;
}

export const findEntry = (items, id) => items.find(i => i.id === id) ?? null;

export const removeEntry = (items, id) => items.filter(i => i.id !== id);

/** Records how far through a passage you got, without marking it finished. */
/**
 * Saves where you stopped. By default the furthest point wins; `allowBackward`
 * saves the actual stopping point, for readers that resume from the saved word
 * (so restarting or rewinding and then leaving resumes where you really were).
 */
export function recordProgress(items, id, progressIndex, { allowBackward = false } = {}) {
    return items.map(item => (
        item.id === id
            ? { ...item, progressIndex: allowBackward ? Math.max(0, progressIndex) : Math.max(item.progressIndex, progressIndex), lastReadAt: todayKey() }
            : item
    ));
}

/**
 * Where reopening a passage should start.
 *
 * Reaching the last word is not a resume point: there would be nothing left to
 * read, and the reader would open on a blank screen that logs a zero-word
 * session the moment you pressed play. That happens for real — read to the end,
 * then leave the quiz through the sidebar, and the stored position is the end
 * of the text. Answered here rather than at each call site, because the Library
 * list and the reader were already answering it differently.
 */
export function resumePoint(item) {
    if (!item) return 0;
    const at = Number.isInteger(item.progressIndex) ? item.progressIndex : 0;
    return at > 0 && at < item.words ? at : 0;
}

/** Whether a passage was left part-way through, as opposed to unread or done. */
export const isPartiallyRead = (item) => resumePoint(item) > 0;

export function recordAttempt(items, id, { wpm, score, kind = 'read' }) {
    return items.map(item => {
        if (item.id !== id) return item;
        // A skim samples the text rather than reading it, so it neither marks
        // the passage finished nor touches its retention schedule.
        if (kind === 'skim') {
            return { ...item, lastReadAt: todayKey(), progressIndex: 0, attempts: [...item.attempts, { date: todayKey(), wpm, score, kind }] };
        }
        return {
            ...item,
            lastReadAt: todayKey(),
            completedAt: item.completedAt ?? todayKey(),
            // Finishing resets the resume point so a replay starts clean.
            progressIndex: 0,
            attempts: [...item.attempts, { date: todayKey(), wpm, score, kind }]
        };
    });
}

/**
 * When a completed passage should next be re-quizzed. Null when it has no
 * questions to ask, was never finished, or has run out of the schedule.
 */
export function nextRecallOn(item) {
    if (isBook(item)) return null;
    if (!item.completedAt || !item.questions?.length) return null;
    const recalls = item.attempts.filter(a => a.kind === 'recall').length;
    if (recalls >= RECALL_INTERVALS.length) return null;

    const counted = item.attempts.filter(a => a.kind !== 'skim');
    const lastDate = counted.length ? counted[counted.length - 1].date : item.completedAt;
    const [y, m, d] = lastDate.split('-').map(Number);
    const due = new Date(Date.UTC(y, m - 1, d + RECALL_INTERVALS[recalls]));
    const pad = (n) => String(n).padStart(2, '0');
    return `${due.getUTCFullYear()}-${pad(due.getUTCMonth() + 1)}-${pad(due.getUTCDate())}`;
}

export function isRecallDue(item, today = todayKey()) {
    const due = nextRecallOn(item);
    return due !== null && daysBetween(due, today) >= 0;
}

export const recallQueue = (items, today = todayKey()) =>
    items.filter(i => isRecallDue(i, today)).sort((a, b) => (nextRecallOn(a) < nextRecallOn(b) ? -1 : 1));

export function addPassageBookmark(items, id, { index, snippet, note = '' }) {
    return items.map(item => (item.id === id && !isBook(item) ? {
        ...item,
        bookmarks: [
            {
                id: `bm-${Date.now()}`,
                index: Math.max(0, index),
                snippet: String(snippet ?? '').slice(0, 120),
                note: String(note ?? '').trim().slice(0, 280),
                createdAt: todayKey()
            },
            ...(item.bookmarks ?? []).filter(b => Math.abs(b.index - index) >= 5)
        ].slice(0, 50)
    } : item));
}

export function removePassageBookmark(items, id, bookmarkId) {
    return items.map(item => (item.id === id && !isBook(item)
        ? { ...item, bookmarks: (item.bookmarks ?? []).filter(b => b.id !== bookmarkId) }
        : item));
}

/** Turns a stored entry back into something the reader or drill can run. */
export function toPassage(item) {
    return item.kind === 'push'
        ? { id: item.id, title: item.title, sectionA: item.sectionA, sectionB: item.sectionB, questions: item.questions }
        : { id: item.id, title: item.title, text: item.text, questions: item.questions, gistQuestions: item.gistQuestions ?? [] };
}

export function migrateLibrary(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(i => i && typeof i.id === 'string' && (typeof i.text === 'string' || typeof i.sectionA === 'string' || i.kind === 'book'))
        .map(i => (i.kind === 'book' ? migrateBook(i) : {
            ...createEntry({
                id: i.id, title: i.title, source: i.source ?? 'import', kind: i.kind ?? 'read',
                text: i.text, sectionA: i.sectionA, sectionB: i.sectionB,
                questions: Array.isArray(i.questions) ? i.questions : [],
                gistQuestions: Array.isArray(i.gistQuestions) ? i.gistQuestions : []
            }),
            createdAt: typeof i.createdAt === 'string' ? i.createdAt : todayKey(),
            lastReadAt: typeof i.lastReadAt === 'string' ? i.lastReadAt : null,
            completedAt: typeof i.completedAt === 'string' ? i.completedAt : null,
            progressIndex: Number.isInteger(i.progressIndex) ? i.progressIndex : 0,
            bookmarks: Array.isArray(i.bookmarks)
                ? i.bookmarks
                    .filter(b => b && Number.isInteger(b.index))
                    .map(b => ({
                        id: typeof b.id === 'string' ? b.id : `bm-${b.index}`,
                        index: Math.max(0, b.index),
                        snippet: String(b.snippet ?? '').slice(0, 120),
                        note: typeof b.note === 'string' ? b.note.slice(0, 280) : '',
                        createdAt: typeof b.createdAt === 'string' ? b.createdAt : todayKey()
                    }))
                    .slice(0, 50)
                : [],
            attempts: Array.isArray(i.attempts) ? i.attempts.filter(a => a && typeof a.date === 'string') : []
        }))
        .filter(Boolean);
}
