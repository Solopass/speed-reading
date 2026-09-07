import { daysBetween, todayKey } from './stats';

const MAX_ITEMS = 60;

/**
 * Spacing between retention re-tests, in days. Reading something quickly is
 * only worth anything if it is still there later, so a passage you completed
 * comes back to be re-quizzed on a widening schedule.
 */
export const RECALL_INTERVALS = [2, 7, 21, 60];

export const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;

export function createEntry({ id, title, source, kind = 'read', text, sectionA, sectionB, questions = [] }) {
    return {
        id: id ?? `p-${Date.now()}`,
        title: title || 'Untitled passage',
        source,                       // 'ai' | 'import' | 'youtube' | 'builtin'
        kind,                         // 'read' (single text) | 'push' (two sections)
        text: text ?? null,
        sectionA: sectionA ?? null,
        sectionB: sectionB ?? null,
        questions,
        words: wordCount(kind === 'push' ? `${sectionA} ${sectionB}` : (text ?? '')),
        createdAt: todayKey(),
        lastReadAt: null,
        progressIndex: 0,
        completedAt: null,
        attempts: []                  // { date, wpm, score, kind: 'read' | 'recall' }
    };
}

const withoutOldest = (items) =>
    (items.length <= MAX_ITEMS ? items : [...items].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).slice(items.length - MAX_ITEMS));

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
export function recordProgress(items, id, progressIndex) {
    return items.map(item => (
        item.id === id
            ? { ...item, progressIndex: Math.max(item.progressIndex, progressIndex), lastReadAt: todayKey() }
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
    if (!item.completedAt || !item.questions?.length) return null;
    const recalls = item.attempts.filter(a => a.kind === 'recall').length;
    if (recalls >= RECALL_INTERVALS.length) return null;

    const lastDate = item.attempts.length ? item.attempts[item.attempts.length - 1].date : item.completedAt;
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

/** Turns a stored entry back into something the reader or drill can run. */
export function toPassage(item) {
    return item.kind === 'push'
        ? { id: item.id, title: item.title, sectionA: item.sectionA, sectionB: item.sectionB, questions: item.questions }
        : { id: item.id, title: item.title, text: item.text, questions: item.questions };
}

export function migrateLibrary(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(i => i && typeof i.id === 'string' && (typeof i.text === 'string' || typeof i.sectionA === 'string'))
        .map(i => ({
            ...createEntry({
                id: i.id, title: i.title, source: i.source ?? 'import', kind: i.kind ?? 'read',
                text: i.text, sectionA: i.sectionA, sectionB: i.sectionB,
                questions: Array.isArray(i.questions) ? i.questions : []
            }),
            createdAt: typeof i.createdAt === 'string' ? i.createdAt : todayKey(),
            lastReadAt: typeof i.lastReadAt === 'string' ? i.lastReadAt : null,
            completedAt: typeof i.completedAt === 'string' ? i.completedAt : null,
            progressIndex: Number.isInteger(i.progressIndex) ? i.progressIndex : 0,
            attempts: Array.isArray(i.attempts) ? i.attempts.filter(a => a && typeof a.date === 'string') : []
        }));
}
