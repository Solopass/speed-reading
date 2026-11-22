import { describe, expect, it } from 'vitest';
import { continueReading, weekSummary } from './dashboard';

describe('continueReading', () => {
    const book = (id, lastReadAt, extra = {}) => ({
        id, kind: 'book', title: `Book ${id}`, lastReadAt, completedAt: null, currentChapter: 1, words: 200,
        chapters: [
            { title: 'One', words: 100, progressIndex: 0, completedAt: '2026-11-01' },
            { title: 'Two', words: 100, progressIndex: 50, completedAt: null }
        ],
        ...extra
    });
    const passage = (id, lastReadAt, progressIndex, extra = {}) => ({ id, kind: 'passage', title: `P ${id}`, lastReadAt, progressIndex, words: 400, completedAt: null, ...extra });

    it('lists unfinished books and part-read passages, most recent first', () => {
        const out = continueReading([
            book('b1', '2026-11-20'),
            passage('p1', '2026-11-21', 100),
            passage('p2', '2026-11-22', 0),               // not started
            passage('p3', '2026-11-22', 50, { completedAt: '2026-11-22' }),
            book('b2', '2026-11-22', { completedAt: '2026-11-22' }),
            { id: 'x', title: 'never opened', progressIndex: 0 }
        ]);
        expect(out.map(o => o.id)).toEqual(['p1', 'b1']);
        expect(out[1]).toMatchObject({ kind: 'book', chapterIndex: 1, pct: 75, detail: 'Chapter 2 of 2 · Two' });
        expect(out[0]).toMatchObject({ kind: 'passage', pct: 25, detail: '300 words left' });
    });
});

describe('weekSummary', () => {
    const today = '2026-11-22';
    const history = [
        { date: '2026-11-21', kind: 'session', words: 1200, elapsedMs: 240000 },
        { date: '2026-11-18', kind: 'session', words: 800, elapsedMs: 180000 },
        { date: '2026-11-17', kind: 'baseline', words: 300, elapsedMs: 90000 },
        { date: '2026-11-12', kind: 'session', words: 500, elapsedMs: 120000 }
    ];
    const check = (date, ok, wpm) => ({ date, ok, wpm });
    const log = [
        check('2026-11-21', true, 420), check('2026-11-21', true, 430), check('2026-11-20', true, 410),
        check('2026-11-20', true, 520), check('2026-11-20', false, 530),
        check('2026-11-10', false, 400)
    ];

    it('sums this week (excluding the baseline test) and last week separately', () => {
        const { current, previous } = weekSummary(history, log, today);
        expect(current).toMatchObject({ minutes: 7, words: 2000, sessions: 2, checks: 5, checkPct: 80 });
        expect(previous).toMatchObject({ minutes: 2, words: 500, sessions: 1, checks: 1, checkPct: 0 });
    });

    it('finds the fastest band held at 80%+ with at least three checks', () => {
        expect(weekSummary(history, log, today).current.solidWpm).toBe(400);
        expect(weekSummary([], [], today).current).toMatchObject({ minutes: 0, checkPct: null, solidWpm: null });
    });
});

describe('continueReading without a stored word count', () => {
    it('counts the words from the text', () => {
        const text = Array.from({ length: 100 }, () => 'word').join(' ');
        const out = continueReading([{ id: 'p', title: 'Old', lastReadAt: '2026-11-20', progressIndex: 25, text, completedAt: null }]);
        expect(out[0]).toMatchObject({ pct: 25, detail: '75 words left' });
    });
});
