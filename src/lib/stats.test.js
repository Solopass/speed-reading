import { describe, expect, it } from 'vitest';
import {
    DEFAULT_STATS, adaptTarget, averageComprehension, baselineDelta, clampWpm, createSession,
    daysBetween, goalProgress, level, migrateHistory, migrateStats, nextStreak,
    recentEffectiveWpm, scoredSessions, sessionsToGoal, todayKey, WPM_MAX, WPM_MIN
} from './stats';

const scored = (wpm, comprehension) => ({
    wpm, comprehension, scored: true, effectiveWpm: Math.round((wpm * comprehension) / 100)
});

describe('clampWpm', () => {
    it('holds the floor and ceiling', () => {
        expect(clampWpm(10)).toBe(WPM_MIN);
        expect(clampWpm(99999)).toBe(WPM_MAX);
        expect(clampWpm(412.4)).toBe(412);
    });
});

describe('date helpers', () => {
    it('formats a local calendar date, zero-padded', () => {
        expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
        expect(todayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
    });

    it('counts days across month and year boundaries', () => {
        expect(daysBetween('2026-09-04', '2026-09-05')).toBe(1);
        expect(daysBetween('2026-08-31', '2026-09-01')).toBe(1);
        expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
        expect(daysBetween('2026-09-05', '2026-09-04')).toBe(-1);
    });
});

describe('nextStreak', () => {
    it('starts at 1 with no history', () => {
        expect(nextStreak(0, null, '2026-09-04')).toBe(1);
    });

    it('does not double-count a second session on the same day', () => {
        expect(nextStreak(4, '2026-09-04', '2026-09-04')).toBe(4);
    });

    it('extends on a consecutive day', () => {
        expect(nextStreak(4, '2026-09-03', '2026-09-04')).toBe(5);
    });

    // The original bug: any date difference incremented, so a three-month gap
    // still counted as +1 and the streak never reset.
    it('resets after a missed day', () => {
        expect(nextStreak(40, '2026-09-02', '2026-09-04')).toBe(1);
        expect(nextStreak(40, '2026-06-01', '2026-09-04')).toBe(1);
    });
});

describe('adaptTarget', () => {
    it('climbs on a perfect quiz and backs off harder than it climbs', () => {
        expect(adaptTarget(300, 100)).toBeGreaterThan(300);
        expect(adaptTarget(300, 40)).toBeLessThan(300);
        expect(300 - adaptTarget(300, 40)).toBeGreaterThan(adaptTarget(300, 100) - 300);
    });

    // Regression: rounding to the nearest 5 nudged the target even when the
    // multiplier was exactly 1, so "hold" drifted upward every session.
    it('leaves the target untouched when holding', () => {
        expect(adaptTarget(304, 80)).toBe(304);
        let target = 304;
        for (let i = 0; i < 20; i++) target = adaptTarget(target, 80);
        expect(target).toBe(304);
    });

    it('maps the only achievable 5-question scores sensibly', () => {
        expect(adaptTarget(300, 100)).toBeGreaterThan(300); // 5/5
        expect(adaptTarget(300, 80)).toBe(300);             // 4/5
        expect(adaptTarget(300, 60)).toBeLessThan(300);     // 3/5
        expect(adaptTarget(300, 40)).toBeLessThan(adaptTarget(300, 60));
    });

    it('stays inside the clamp at both extremes', () => {
        expect(adaptTarget(WPM_MAX, 100)).toBe(WPM_MAX);
        expect(adaptTarget(WPM_MIN, 0)).toBe(WPM_MIN);
    });

    it('scales proportionally rather than by a fixed step', () => {
        expect(adaptTarget(1000, 100) - 1000).toBeGreaterThan(adaptTarget(200, 100) - 200);
    });
});

describe('goal projection', () => {
    it('counts the perfect sessions needed to reach a goal', () => {
        expect(sessionsToGoal(2000, 2000)).toBe(0);
        expect(sessionsToGoal(2500, 2000)).toBe(0);
        expect(sessionsToGoal(304, 2000)).toBe(39);
    });

    it('reports progress between baseline and goal', () => {
        expect(goalProgress({ baselineWpm: 300, targetWpm: 300 }, 2000)).toBe(0);
        expect(goalProgress({ baselineWpm: 300, targetWpm: 2000 }, 2000)).toBe(100);
        expect(goalProgress({ baselineWpm: 300, targetWpm: 1150 }, 2000)).toBe(50);
    });

    it('never reports outside 0-100', () => {
        expect(goalProgress({ baselineWpm: 300, targetWpm: 200 }, 2000)).toBe(0);
        expect(goalProgress({ baselineWpm: 300, targetWpm: 5000 }, 2000)).toBe(100);
    });
});

describe('baselineDelta', () => {
    it('is null until a baseline exists', () => {
        expect(baselineDelta({ baselineWpm: null, targetWpm: 300 })).toBeNull();
    });

    it('reports percentage change from baseline', () => {
        expect(baselineDelta({ baselineWpm: 300, targetWpm: 360 })).toBe(20);
        expect(baselineDelta({ baselineWpm: 400, targetWpm: 300 })).toBe(-25);
    });
});

describe('createSession', () => {
    it('computes effective WPM for a scored session', () => {
        const s = createSession({ index: 1, wpm: 500, score: 60, words: 200, elapsedMs: 24000 });
        expect(s.scored).toBe(true);
        expect(s.effectiveWpm).toBe(300);
    });

    // Unscored practice used to be recorded as 100% comprehension, which
    // inflated the retention average every time you pasted your own text.
    it('records a null score rather than inventing 100%', () => {
        const s = createSession({ index: 2, wpm: 400, score: null, words: 100, elapsedMs: 15000 });
        expect(s.scored).toBe(false);
        expect(s.comprehension).toBeNull();
        expect(s.effectiveWpm).toBeNull();
    });

    it('labels the baseline distinctly', () => {
        expect(createSession({ index: 1, wpm: 300, score: 80, kind: 'baseline' }).id).toBe('Base');
    });
});

describe('aggregates', () => {
    const history = [
        scored(300, 100),
        { wpm: 250, comprehension: null, scored: false, effectiveWpm: null },
        scored(400, 50)
    ];

    it('ignores unscored sessions everywhere', () => {
        expect(scoredSessions(history)).toHaveLength(2);
        expect(averageComprehension(history)).toBe(75);
        expect(recentEffectiveWpm(history)).toBe(250);
    });

    it('returns null rather than 0 when nothing is measured', () => {
        expect(averageComprehension([])).toBeNull();
        expect(recentEffectiveWpm([])).toBeNull();
        expect(level([])).toBe(1);
    });

    it('only averages the most recent n', () => {
        const many = [scored(100, 100), scored(100, 100), scored(1000, 100)];
        expect(recentEffectiveWpm(many, 1)).toBe(1000);
    });
});

describe('migrateStats', () => {
    // Regression: Number(null) is 0 and passes Number.isFinite, so a stored
    // null baseline came back as a real 150 WPM one. Every new user got a
    // fabricated baseline on their second page load.
    it('keeps a null baseline null across a round trip', () => {
        const roundTripped = migrateStats(JSON.parse(JSON.stringify(DEFAULT_STATS)));
        expect(roundTripped.baselineWpm).toBeNull();
        expect(roundTripped.baselineComprehension).toBeNull();
        expect(roundTripped.baselineDate).toBeNull();
    });

    it('preserves a real baseline', () => {
        const s = migrateStats({ targetWpm: 320, baselineWpm: 304, baselineComprehension: 80, baselineDate: '2026-09-04' });
        expect(s.baselineWpm).toBe(304);
        expect(s.baselineComprehension).toBe(80);
        expect(s.baselineDate).toBe('2026-09-04');
    });

    it('reads the pre-targetWpm shape, where the prescription lived in effectiveWpm', () => {
        expect(migrateStats({ effectiveWpm: 425 }).targetWpm).toBe(425);
        expect(migrateStats({ effectiveWpm: 425 }).baselineWpm).toBeNull();
    });

    it('drops a locale-formatted date rather than miscounting the streak', () => {
        expect(migrateStats({ lastSessionDate: '9/4/2026' }).lastSessionDate).toBeNull();
        expect(migrateStats({ lastSessionDate: '2026-09-04' }).lastSessionDate).toBe('2026-09-04');
    });

    it('survives junk', () => {
        expect(migrateStats(null)).toEqual(DEFAULT_STATS);
        expect(migrateStats('nonsense')).toEqual(DEFAULT_STATS);
        expect(migrateStats({ targetWpm: NaN, streak: 'x' }).targetWpm).toBe(DEFAULT_STATS.targetWpm);
    });
});

describe('migrateHistory', () => {
    it('drops entries with no usable speed', () => {
        expect(migrateHistory([{ wpm: 'abc' }, { wpm: 300 }])).toHaveLength(1);
        expect(migrateHistory('nope')).toEqual([]);
    });

    it('infers scored-ness from an older record without the flag', () => {
        const [a, b] = migrateHistory([{ wpm: 300, comprehension: 80 }, { wpm: 300, comprehension: null }]);
        expect(a.scored).toBe(true);
        expect(b.scored).toBe(false);
    });

    it('keeps null word counts null instead of zeroing them', () => {
        const [entry] = migrateHistory([{ wpm: 300, words: null, elapsedMs: null }]);
        expect(entry.words).toBeNull();
        expect(entry.elapsedMs).toBeNull();
    });
});


describe('the speed actually in force', () => {
    const stats = { targetWpm: 300, baselineWpm: 300 };

    it('measures against the target while adaptation is on', () => {
        expect(baselineDelta(stats)).toBe(0);
        expect(goalProgress({ ...stats, targetWpm: 600 }, 900)).toBe(50);
    });

    // With adaptation off the reader opens at settings.baseWpm, and targetWpm
    // sits frozen wherever adaptation last left it. The dashboard showed the
    // locked speed on the card and computed everything below it from the stale
    // target, so one screen carried three numbers that disagreed.
    it('measures against the locked speed when one is passed in', () => {
        expect(baselineDelta(stats, 600)).toBe(100);
        expect(goalProgress(stats, 900, 600)).toBe(50);
        expect(sessionsToGoal(600, 900)).toBeLessThan(sessionsToGoal(300, 900));
    });

    it('still reports nothing without a baseline to measure from', () => {
        expect(baselineDelta({ targetWpm: 300, baselineWpm: null }, 800)).toBeNull();
    });

    it('reports a locked speed below baseline as a real decrease', () => {
        expect(baselineDelta({ targetWpm: 500, baselineWpm: 400 }, 300)).toBe(-25);
    });
});
