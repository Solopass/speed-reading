import { describe, expect, it } from 'vitest';
import {
    DEFAULT_STATS, addBaselineSample, backupReminderDue, byMode, createSession, dailyActivity,
    linearTrend, markBackedUp, migrateHistory, migrateStats, recentEffectiveWpm, scoredSessions,
    skimSessions, snoozeBackup, weeklyMinutes
} from './stats';

const session = (over) => ({
    ...createSession({ index: 1, wpm: 400, score: 80, words: 250, elapsedMs: 60000 }),
    ...over
});

describe('skim sessions', () => {
    it('are kept out of reading averages but listed on their own', () => {
        const history = [
            session({ wpm: 300, comprehension: 100, effectiveWpm: 300 }),
            session({ kind: 'skim', mode: 'skim', wpm: 1200, comprehension: 100, effectiveWpm: 1200 })
        ];
        expect(scoredSessions(history)).toHaveLength(1);
        expect(skimSessions(history)).toHaveLength(1);
        expect(recentEffectiveWpm(history)).toBe(300);
    });

    it('createSession records the mode and migrateHistory keeps it', () => {
        const s = createSession({ index: 2, wpm: 500, score: 60, words: 100, elapsedMs: 1, kind: 'skim', mode: 'skim' });
        expect(s.mode).toBe('skim');
        expect(migrateHistory([s])[0].mode).toBe('skim');
        expect(migrateHistory([{ wpm: 300 }])[0].mode).toBeNull();
    });
});

describe('addBaselineSample', () => {
    it('averages up to three reads and sets the target to the mean', () => {
        let stats = addBaselineSample(DEFAULT_STATS, { wpm: 200, score: 80, date: '2026-01-01' }, { fresh: true });
        stats = addBaselineSample(stats, { wpm: 300, score: 100, date: '2026-01-02' });
        expect(stats.baselineWpm).toBe(250);
        expect(stats.baselineComprehension).toBe(90);
        expect(stats.targetWpm).toBe(250);
        stats = addBaselineSample(stats, { wpm: 400, score: 60 });
        stats = addBaselineSample(stats, { wpm: 400, score: 60 });
        expect(stats.baselineSamples).toHaveLength(3);
        expect(stats.baselineWpm).toBe(367);
    });

    it('an added passage leaves a trained target alone', () => {
        const base = addBaselineSample(DEFAULT_STATS, { wpm: 250, score: 80 }, { fresh: true });
        const trained = { ...base, targetWpm: 400 };
        const added = addBaselineSample(trained, { wpm: 300, score: 80 });
        expect(added.baselineWpm).toBe(275);
        expect(added.targetWpm).toBe(400);
        expect(addBaselineSample(trained, { wpm: 300, score: 80 }, { fresh: true }).targetWpm).toBe(300);
    });

    it('a retake starts a fresh set', () => {
        const old = addBaselineSample(DEFAULT_STATS, { wpm: 200, score: 80 }, { fresh: true });
        const retake = addBaselineSample(old, { wpm: 500, score: 80 }, { fresh: true });
        expect(retake.baselineSamples).toHaveLength(1);
        expect(retake.baselineWpm).toBe(500);
    });

    it('migrates a legacy single baseline into the first sample', () => {
        const stats = migrateStats({ baselineWpm: 280, baselineComprehension: 80, baselineDate: '2026-01-01' });
        expect(stats.baselineSamples).toEqual([{ wpm: 280, score: 80, date: '2026-01-01' }]);
        expect(migrateStats({}).baselineSamples).toEqual([]);
    });
});

describe('backup reminder', () => {
    const base = { ...DEFAULT_STATS };

    it('stays quiet on a new profile and nudges after three unexported sessions', () => {
        expect(backupReminderDue({ ...base, sessionsCompleted: 2 }, '2026-01-10')).toBe(false);
        expect(backupReminderDue({ ...base, sessionsCompleted: 3 }, '2026-01-10')).toBe(true);
    });

    it('after an export, waits for five sessions or seven days with something new', () => {
        const backed = markBackedUp({ ...base, sessionsCompleted: 10 }, '2026-01-01');
        expect(backupReminderDue(backed, '2026-01-20')).toBe(false);
        expect(backupReminderDue({ ...backed, sessionsCompleted: 11 }, '2026-01-03')).toBe(false);
        expect(backupReminderDue({ ...backed, sessionsCompleted: 11 }, '2026-01-08')).toBe(true);
        expect(backupReminderDue({ ...backed, sessionsCompleted: 15 }, '2026-01-02')).toBe(true);
    });

    it('a snooze holds for three days', () => {
        const due = { ...base, sessionsCompleted: 4 };
        const snoozed = snoozeBackup(due, '2026-01-10');
        expect(snoozed.backupSnoozedUntil).toBe('2026-01-13');
        expect(backupReminderDue(snoozed, '2026-01-12')).toBe(false);
        expect(backupReminderDue(snoozed, '2026-01-13')).toBe(true);
    });
});

describe('analytics helpers', () => {
    it('linearTrend fits a line and refuses degenerate input', () => {
        const t = linearTrend([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }]);
        expect(t.slope).toBeCloseTo(2);
        expect(t.at(3)).toBeCloseTo(7);
        expect(linearTrend([{ x: 1, y: 1 }])).toBeNull();
        expect(linearTrend([{ x: 1, y: 1 }, { x: 1, y: 2 }])).toBeNull();
    });

    it('dailyActivity covers every day in the window', () => {
        const days = dailyActivity([{ date: '2026-03-10', elapsedMs: 120000 }, { date: '2026-03-10', elapsedMs: 60000 }], 7, '2026-03-10');
        expect(days).toHaveLength(7);
        expect(days[0].date).toBe('2026-03-04');
        expect(days[6]).toEqual({ date: '2026-03-10', sessions: 2, minutes: 3 });
    });

    it('weeklyMinutes buckets by Monday-start week', () => {
        // 2026-03-11 is a Wednesday; its week starts Monday 2026-03-09.
        const weeks = weeklyMinutes([
            { date: '2026-03-09', elapsedMs: 600000 },
            { date: '2026-03-08', elapsedMs: 300000 },
            { date: '2025-01-01', elapsedMs: 300000 }
        ], 2, '2026-03-11');
        expect(weeks).toEqual([
            { week: '2026-03-02', minutes: 5, sessions: 1 },
            { week: '2026-03-09', minutes: 10, sessions: 1 }
        ]);
    });

    it('byMode averages quizzed sessions per mode and skips baselines', () => {
        const rows = byMode([
            session({ mode: 'rsvp', wpm: 400, comprehension: 80, effectiveWpm: 320 }),
            session({ mode: 'rsvp', wpm: 600, comprehension: 60, effectiveWpm: 360 }),
            session({ kind: 'skim', mode: 'skim', wpm: 1000, comprehension: 80, effectiveWpm: 800 }),
            session({ kind: 'baseline', mode: 'natural' })
        ]);
        expect(rows[0]).toMatchObject({ mode: 'rsvp', sessions: 2, wpm: 500, comprehension: 70, effectiveWpm: 340 });
        expect(rows.find(r => r.mode === 'skim').label).toBe('Skim');
        expect(rows.some(r => r.mode === 'natural')).toBe(false);
    });
});
