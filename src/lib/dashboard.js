// What the dashboard shows at a glance: where to pick up reading, and how this
// week compares with the last one.

import { bookProgress, isBook, nextChapterIndex } from './book';
import { checkpointsBySpeed } from './checkpoint';
import { daysBetween, todayKey } from './stats';

/**
 * Up to `limit` things to resume, most recently read first: books not yet
 * finished, and passages left part-way through.
 * Returns [{ id, kind: 'book' | 'passage', title, detail, pct, chapterIndex }].
 */
export function continueReading(library, limit = 3) {
    const items = [];
    for (const item of Array.isArray(library) ? library : []) {
        if (!item?.lastReadAt) continue;
        if (isBook(item)) {
            if (item.completedAt) continue;
            const ch = nextChapterIndex(item);
            const chapter = item.chapters[ch];
            items.push({
                id: item.id, kind: 'book', title: item.title, lastReadAt: item.lastReadAt, chapterIndex: ch,
                detail: `Chapter ${ch + 1} of ${item.chapters.length}${chapter?.title ? ` · ${chapter.title}` : ''}`,
                pct: bookProgress(item).pct
            });
        } else if (item.kind !== 'push' && item.progressIndex > 0 && !item.completedAt) {
            // Older entries may lack a word count; count it from the text.
            const words = Math.max(1, item.words || String(item.text ?? '').trim().split(/\s+/).filter(Boolean).length || 1);
            items.push({
                id: item.id, kind: 'passage', title: item.title, lastReadAt: item.lastReadAt, chapterIndex: null,
                detail: `${Math.max(0, words - item.progressIndex).toLocaleString()} words left`,
                pct: Math.min(99, Math.round((item.progressIndex / words) * 100))
            });
        }
    }
    // Dates have no time of day, so ties go to whichever is further along.
    items.sort((a, b) => (a.lastReadAt < b.lastReadAt ? 1 : a.lastReadAt > b.lastReadAt ? -1 : b.pct - a.pct));
    return items.slice(0, limit);
}

/** Sessions and checkpoints from the 7 days ending `today`, and the 7 before. */
function windows(today) {
    const inWeek = (date, back) => {
        if (typeof date !== 'string') return false;
        const d = daysBetween(date, today);
        return d >= back && d < back + 7;
    };
    return { thisWeek: (date) => inWeek(date, 0), lastWeek: (date) => inWeek(date, 7) };
}

function summarise(sessions, checks) {
    const reading = sessions.filter(s => s.kind !== 'baseline');
    const right = checks.filter(c => c.ok).length;
    // The fastest 100-WPM band where checks were mostly right (80%+, 3+ checks).
    const solid = checkpointsBySpeed(checks).filter(b => b.n >= 3 && b.pct >= 80);
    return {
        minutes: Math.round(reading.reduce((n, s) => n + (Number.isFinite(s.elapsedMs) ? s.elapsedMs : 0), 0) / 60000),
        words: reading.reduce((n, s) => n + (Number.isFinite(s.words) ? s.words : 0), 0),
        sessions: reading.length,
        checks: checks.length,
        checkPct: checks.length ? Math.round((right / checks.length) * 100) : null,
        solidWpm: solid.length ? solid[solid.length - 1].from : null
    };
}

/**
 * This week against last week: minutes read, words, sessions, checkpoint
 * accuracy, and the fastest speed you kept 80%+ of checkpoints right at.
 */
export function weekSummary(history, checkpointLog, today = todayKey()) {
    const { thisWeek, lastWeek } = windows(today);
    const sessions = Array.isArray(history) ? history : [];
    const checks = (Array.isArray(checkpointLog) ? checkpointLog : []).filter(c => typeof c?.date === 'string');
    return {
        current: summarise(sessions.filter(s => thisWeek(s.date)), checks.filter(c => thisWeek(c.date))),
        previous: summarise(sessions.filter(s => lastWeek(s.date)), checks.filter(c => lastWeek(c.date)))
    };
}
