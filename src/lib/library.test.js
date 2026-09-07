import { describe, expect, it } from 'vitest';
import {
    RECALL_INTERVALS,
    createEntry,
    findEntry,
    isPartiallyRead,
    isRecallDue,
    migrateLibrary,
    nextRecallOn,
    recallQueue,
    recordAttempt,
    recordProgress,
    removeEntry,
    resumePoint,
    toPassage,
    upsertEntry
} from './library';

const quiz = [{ q: 'Q', options: ['a', 'b', 'c', 'd'], answer: 0 }];

const entry = (overrides = {}) => ({
    ...createEntry({
        id: 'p1', title: 'Test passage', source: 'ai',
        text: 'one two three four five', questions: quiz
    }),
    ...overrides
});

const completed = (on, attempts = []) => entry({
    completedAt: on,
    lastReadAt: on,
    attempts: attempts.length ? attempts : [{ date: on, wpm: 400, score: 80, kind: 'read' }]
});

describe('createEntry', () => {
    it('counts words for a single-text passage', () => {
        expect(entry().words).toBe(5);
    });

    it('counts both sections of a push drill', () => {
        const drill = createEntry({ title: 'D', source: 'ai', kind: 'push', sectionA: 'a b c', sectionB: 'd e' });
        expect(drill.words).toBe(5);
    });

    it('starts unread', () => {
        const e = entry();
        expect(e.progressIndex).toBe(0);
        expect(e.completedAt).toBeNull();
        expect(e.attempts).toEqual([]);
    });
});

describe('collection operations', () => {
    it('adds, finds, updates in place, and removes', () => {
        let items = upsertEntry([], entry());
        expect(items).toHaveLength(1);
        expect(findEntry(items, 'p1').title).toBe('Test passage');

        items = upsertEntry(items, { ...entry(), title: 'Renamed' });
        expect(items).toHaveLength(1);
        expect(findEntry(items, 'p1').title).toBe('Renamed');

        expect(removeEntry(items, 'p1')).toHaveLength(0);
        expect(findEntry([], 'nope')).toBeNull();
    });

    it('caps the collection, dropping the oldest', () => {
        let items = [];
        for (let i = 0; i < 70; i++) {
            items = upsertEntry(items, { ...entry({ id: `p${i}` }), createdAt: `2026-01-${String((i % 28) + 1).padStart(2, '0')}` });
        }
        expect(items.length).toBeLessThanOrEqual(60);
    });
});

describe('recordProgress', () => {
    it('stores the resume point', () => {
        const items = recordProgress([entry()], 'p1', 3);
        expect(items[0].progressIndex).toBe(3);
        expect(items[0].lastReadAt).not.toBeNull();
    });

    // Re-reading the opening of a passage must not throw away how far you got.
    it('never moves the resume point backwards', () => {
        let items = recordProgress([entry()], 'p1', 40);
        items = recordProgress(items, 'p1', 5);
        expect(items[0].progressIndex).toBe(40);
    });

    it('leaves other passages alone', () => {
        const items = recordProgress([entry(), entry({ id: 'p2' })], 'p1', 3);
        expect(items[1].progressIndex).toBe(0);
    });
});

describe('recordAttempt', () => {
    it('marks completion and clears the resume point', () => {
        const items = recordAttempt([entry({ progressIndex: 4 })], 'p1', { wpm: 400, score: 80 });
        expect(items[0].completedAt).not.toBeNull();
        expect(items[0].progressIndex).toBe(0);
        expect(items[0].attempts).toHaveLength(1);
    });

    it('keeps the original completion date across later attempts', () => {
        let items = [completed('2026-09-01')];
        items = recordAttempt(items, 'p1', { wpm: 500, score: 100, kind: 'recall' });
        expect(items[0].completedAt).toBe('2026-09-01');
        expect(items[0].attempts).toHaveLength(2);
    });
});

describe('recall scheduling', () => {
    it('widens the interval with each retention check', () => {
        const first = completed('2026-09-01');
        expect(nextRecallOn(first)).toBe('2026-09-03'); // +2

        const afterOne = { ...first, attempts: [...first.attempts, { date: '2026-09-03', score: 100, kind: 'recall' }] };
        expect(nextRecallOn(afterOne)).toBe('2026-09-10'); // +7

        const afterTwo = { ...afterOne, attempts: [...afterOne.attempts, { date: '2026-09-10', score: 100, kind: 'recall' }] };
        expect(nextRecallOn(afterTwo)).toBe('2026-10-01'); // +21
    });

    it('stops scheduling once the ladder is exhausted', () => {
        const attempts = [{ date: '2026-01-01', score: 80, kind: 'read' }];
        RECALL_INTERVALS.forEach((_, i) => attempts.push({ date: `2026-0${i + 2}-01`, score: 90, kind: 'recall' }));
        expect(nextRecallOn(completed('2026-01-01', attempts))).toBeNull();
    });

    it('never schedules a passage that was never finished or has no questions', () => {
        expect(nextRecallOn(entry())).toBeNull();
        expect(nextRecallOn({ ...completed('2026-09-01'), questions: [] })).toBeNull();
    });

    it('becomes due on the day, not before', () => {
        const item = completed('2026-09-01');
        expect(isRecallDue(item, '2026-09-02')).toBe(false);
        expect(isRecallDue(item, '2026-09-03')).toBe(true);
        expect(isRecallDue(item, '2026-10-01')).toBe(true);
    });

    it('queues the most overdue first', () => {
        const older = { ...completed('2026-09-01'), id: 'old' };
        const newer = { ...completed('2026-09-02'), id: 'new' };
        expect(recallQueue([newer, older], '2026-09-20').map(i => i.id)).toEqual(['old', 'new']);
    });

    it('excludes anything not yet due', () => {
        expect(recallQueue([completed('2026-09-01'), entry()], '2026-09-02')).toEqual([]);
    });
});

describe('toPassage', () => {
    it('unwraps a reading passage', () => {
        expect(toPassage(entry())).toEqual({ id: 'p1', title: 'Test passage', text: 'one two three four five', questions: quiz });
    });

    it('unwraps a push drill with both sections', () => {
        const drill = createEntry({ id: 'd1', title: 'D', source: 'ai', kind: 'push', sectionA: 'a b', sectionB: 'c d', questions: quiz });
        expect(toPassage(drill)).toEqual({ id: 'd1', title: 'D', sectionA: 'a b', sectionB: 'c d', questions: quiz });
    });
});

describe('migrateLibrary', () => {
    it('round-trips entries through JSON without losing history', () => {
        const items = [completed('2026-09-01')];
        const restored = migrateLibrary(JSON.parse(JSON.stringify(items)));
        expect(restored[0].attempts).toHaveLength(1);
        expect(restored[0].completedAt).toBe('2026-09-01');
        expect(restored[0].progressIndex).toBe(0);
    });

    it('drops entries with no readable content', () => {
        expect(migrateLibrary([{ id: 'x' }, entry()])).toHaveLength(1);
        expect(migrateLibrary('nope')).toEqual([]);
        expect(migrateLibrary(null)).toEqual([]);
    });

    it('discards malformed attempt records', () => {
        const [restored] = migrateLibrary([{ ...entry(), attempts: [{ date: '2026-09-01', score: 80 }, null, { score: 50 }] }]);
        expect(restored.attempts).toHaveLength(1);
    });
});


describe('resumePoint', () => {
    const entry = (progressIndex, words = 100) => ({ progressIndex, words });

    it('resumes where you actually stopped', () => {
        expect(resumePoint(entry(40))).toBe(40);
        expect(isPartiallyRead(entry(40))).toBe(true);
    });

    it('is zero for something never opened', () => {
        expect(resumePoint(entry(0))).toBe(0);
        expect(isPartiallyRead(entry(0))).toBe(false);
    });

    // Reaching the end is not a resume point. The reader would open on a blank
    // screen and log a zero-word session the moment you pressed play — which is
    // reachable by reading to the end and then leaving the quiz through the nav.
    it('refuses a position at or past the end of the text', () => {
        expect(resumePoint(entry(100))).toBe(0);
        expect(resumePoint(entry(140))).toBe(0);
        expect(isPartiallyRead(entry(100))).toBe(false);
    });

    it('survives a missing or malformed entry', () => {
        expect(resumePoint(null)).toBe(0);
        expect(resumePoint(undefined)).toBe(0);
        expect(resumePoint({ words: 100 })).toBe(0);
        expect(resumePoint({ progressIndex: 'half', words: 100 })).toBe(0);
    });

    // The end-of-text case has to survive a real round trip through storage,
    // since that is how the bad value got written in the first place.
    it('heals a bad position already saved by an earlier build', () => {
        const item = createEntry({ id: 'p1', title: 'T', source: 'import', text: 'one two three four five' });
        const saved = recordProgress([item], 'p1', 5);
        expect(saved[0].progressIndex).toBe(5);
        expect(resumePoint(migrateLibrary(JSON.parse(JSON.stringify(saved)))[0])).toBe(0);
    });
});
