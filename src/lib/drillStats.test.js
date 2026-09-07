import { describe, expect, it } from 'vitest';
import {
    CHUNK_MAX_WORDS, CHUNK_MIN_WORDS, DRILL_KINDS, DRILL_META, MAX_DRILL_HISTORY,
    PERIPHERAL_CEILING_MS, PERIPHERAL_FLOOR_MS, PERIPHERAL_START_MS,
    bestMetric, chunkThreshold, createDrillResult, drillTrend, drillsOfKind,
    CHUNK_START_WORDS, MIN_RUNS_TO_ADAPT, START_WINDOW,
    latestMetric, migrateDrills, nextChunkSize, nextFlashMs, peripheralThreshold,
    startingChunkSize, startingFlashMs
} from './drillStats';

const run = (kind, metric) => ({ kind, metric, detail: null, date: '2026-09-04' });

describe('nextFlashMs', () => {
    it('shortens after a hit and lengthens after a miss', () => {
        expect(nextFlashMs(400, true)).toBeLessThan(400);
        expect(nextFlashMs(400, false)).toBeGreaterThan(400);
    });

    it('recovers faster than it descends, so one miss undoes more than one hit', () => {
        const afterHit = 400 - nextFlashMs(400, true);
        const afterMiss = nextFlashMs(400, false) - 400;
        expect(afterMiss).toBeGreaterThan(afterHit);
    });

    it('stays inside the floor and ceiling', () => {
        expect(nextFlashMs(PERIPHERAL_FLOOR_MS, true)).toBe(PERIPHERAL_FLOOR_MS);
        expect(nextFlashMs(PERIPHERAL_CEILING_MS, false)).toBe(PERIPHERAL_CEILING_MS);
    });

    it('converges toward the floor on a perfect run', () => {
        let ms = PERIPHERAL_START_MS;
        for (let i = 0; i < 20; i++) ms = nextFlashMs(ms, true);
        expect(ms).toBe(PERIPHERAL_FLOOR_MS);
    });
});

describe('peripheralThreshold', () => {
    it('reports the shortest flash answered correctly', () => {
        expect(peripheralThreshold([
            { flashMs: 400, correct: true },
            { flashMs: 300, correct: true },
            { flashMs: 225, correct: false }
        ])).toBe(300);
    });

    it('is null when nothing was read correctly', () => {
        expect(peripheralThreshold([{ flashMs: 400, correct: false }])).toBeNull();
        expect(peripheralThreshold([])).toBeNull();
    });
});

describe('aggregates', () => {
    const history = [run('peripheral', 300), run('scanning', 8), run('peripheral', 220), run('scanning', 5)];

    it('separates the two drills', () => {
        expect(drillsOfKind(history, 'peripheral')).toHaveLength(2);
        expect(drillsOfKind(history, 'scanning')).toHaveLength(2);
    });

    it('treats lower as better', () => {
        expect(bestMetric(history, 'peripheral')).toBe(220);
        expect(bestMetric(history, 'scanning')).toBe(5);
    });

    it('reports the most recent run separately from the best', () => {
        const withRegression = [...history, run('peripheral', 500)];
        expect(latestMetric(withRegression, 'peripheral')).toBe(500);
        expect(bestMetric(withRegression, 'peripheral')).toBe(220);
    });

    it('returns null rather than 0 with no runs', () => {
        expect(bestMetric([], 'peripheral')).toBeNull();
        expect(latestMetric([], 'scanning')).toBeNull();
    });
});

describe('drillTrend', () => {
    it('waits until there is enough to compare', () => {
        expect(drillTrend([run('peripheral', 400)], 'peripheral')).toBeNull();
        expect(drillTrend(Array(5).fill(run('peripheral', 400)), 'peripheral')).toBeNull();
    });

    it('reports improvement as a negative percentage', () => {
        const history = [400, 400, 400, 200, 200, 200].map(m => run('peripheral', m));
        expect(drillTrend(history, 'peripheral')).toBe(-50);
    });

    it('reports regression as positive', () => {
        const history = [200, 200, 200, 300, 300, 300].map(m => run('peripheral', m));
        expect(drillTrend(history, 'peripheral')).toBe(50);
    });
});

describe('migrateDrills', () => {
    it('keeps valid runs and drops the rest', () => {
        expect(migrateDrills([
            run('peripheral', 300),
            { kind: 'nonsense', metric: 1 },
            { kind: 'scanning', metric: 'abc' },
            null
        ])).toHaveLength(1);
    });

    it('survives junk', () => {
        expect(migrateDrills(null)).toEqual([]);
        expect(migrateDrills('nope')).toEqual([]);
    });

    it('caps history so storage cannot grow without bound', () => {
        expect(migrateDrills(Array(MAX_DRILL_HISTORY + 200).fill(run('scanning', 4)))).toHaveLength(MAX_DRILL_HISTORY);
    });
});

describe('createDrillResult', () => {
    it('stamps the run with today', () => {
        const result = createDrillResult({ kind: 'peripheral', metric: 250 });
        expect(result.kind).toBe('peripheral');
        expect(result.metric).toBe(250);
        expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});


describe('drill metadata', () => {
    it('describes every kind that can be stored', () => {
        DRILL_KINDS.forEach(kind => {
            expect(DRILL_META[kind].label).toBeTruthy();
            expect(typeof DRILL_META[kind].lowerIsBetter).toBe('boolean');
        });
    });
});

describe('chunk perception', () => {
    it('widens after a hit and narrows after a miss', () => {
        expect(nextChunkSize(3, true)).toBe(4);
        expect(nextChunkSize(3, false)).toBe(2);
    });

    it('stays inside its bounds', () => {
        expect(nextChunkSize(CHUNK_MAX_WORDS, true)).toBe(CHUNK_MAX_WORDS);
        expect(nextChunkSize(CHUNK_MIN_WORDS, false)).toBe(CHUNK_MIN_WORDS);
    });

    it('scores the widest chunk actually recalled', () => {
        expect(chunkThreshold([{ size: 2, correct: true }, { size: 4, correct: true }, { size: 5, correct: false }])).toBe(4);
        expect(chunkThreshold([{ size: 2, correct: false }])).toBeNull();
        expect(chunkThreshold([])).toBeNull();
    });
});

describe('direction-aware scoring', () => {
    const chunkRuns = [
        { kind: 'chunk', metric: 2, date: '2026-09-01' },
        { kind: 'chunk', metric: 5, date: '2026-09-02' },
        { kind: 'chunk', metric: 3, date: '2026-09-03' }
    ];

    // More words per fixation is better, unlike every other drill.
    it('takes the maximum for a higher-is-better drill', () => {
        expect(bestMetric(chunkRuns, 'chunk')).toBe(5);
        expect(latestMetric(chunkRuns, 'chunk')).toBe(3);
    });

    it('still takes the minimum for lower-is-better drills', () => {
        const runs = [{ kind: 'schulte', metric: 40 }, { kind: 'schulte', metric: 28 }];
        expect(bestMetric(runs, 'schulte')).toBe(28);
    });

    it('reports improvement as negative for both directions', () => {
        const gettingFaster = [40, 40, 40, 25, 25, 25].map(m => ({ kind: 'schulte', metric: m }));
        expect(drillTrend(gettingFaster, 'schulte')).toBeLessThan(0);

        const gettingWider = [2, 2, 2, 4, 4, 4].map(m => ({ kind: 'chunk', metric: m }));
        expect(drillTrend(gettingWider, 'chunk')).toBeLessThan(0);
    });

    it('does not divide by zero', () => {
        const zeros = [0, 0, 0, 1, 1, 1].map(m => ({ kind: 'chunk', metric: m }));
        expect(drillTrend(zeros, 'chunk')).toBeNull();
    });
});

describe('migrateDrills with the new kinds', () => {
    it('accepts every declared kind', () => {
        const runs = DRILL_KINDS.map(kind => ({ kind, metric: 5, date: '2026-09-01' }));
        expect(migrateDrills(runs)).toHaveLength(DRILL_KINDS.length);
    });
});


describe('startingFlashMs', () => {
    it('opens at the default until there is enough history to trust', () => {
        expect(startingFlashMs([])).toBe(PERIPHERAL_START_MS);
        expect(startingFlashMs([run('peripheral', 100)])).toBe(PERIPHERAL_START_MS);
        expect(MIN_RUNS_TO_ADAPT).toBe(2);
    });

    // Opening at 400ms when you read 100ms flashes burns five of eight rounds
    // walking back down to where the measurement actually happens.
    it('opens near your recent threshold once it knows it', () => {
        const history = [run('peripheral', 100), run('peripheral', 100)];
        expect(startingFlashMs(history)).toBe(133);
    });

    // One step to the easy side: round one should be winnable.
    it('opens easier than the threshold itself', () => {
        const history = [run('peripheral', 120), run('peripheral', 120)];
        expect(startingFlashMs(history)).toBeGreaterThan(120);
        expect(nextFlashMs(startingFlashMs(history), true)).toBe(120);
    });

    // A single lucky round must not set the opening for every future session.
    it('averages recent runs rather than taking the best', () => {
        const history = [run('peripheral', 300), run('peripheral', 300), run('peripheral', 60)];
        expect(startingFlashMs(history)).toBe(293);
    });

    it('only looks at the last few runs', () => {
        const stale = Array.from({ length: 10 }, () => run('peripheral', 800));
        const recent = Array.from({ length: START_WINDOW }, () => run('peripheral', 100));
        expect(startingFlashMs([...stale, ...recent])).toBe(133);
    });

    it('ignores other drills entirely', () => {
        expect(startingFlashMs([run('schulte', 40), run('chunk', 5)])).toBe(PERIPHERAL_START_MS);
    });

    it('holds the clamps', () => {
        const slow = [run('peripheral', 890), run('peripheral', 890)];
        expect(startingFlashMs(slow)).toBe(PERIPHERAL_CEILING_MS);
        expect(startingFlashMs([run('peripheral', 60), run('peripheral', 60)]))
            .toBeGreaterThanOrEqual(PERIPHERAL_FLOOR_MS);
    });
});

describe('startingChunkSize', () => {
    it('opens at the default until there is enough history', () => {
        expect(startingChunkSize([])).toBe(CHUNK_START_WORDS);
        expect(startingChunkSize([run('chunk', 5)])).toBe(CHUNK_START_WORDS);
    });

    it('opens a word under the width you have been managing', () => {
        expect(startingChunkSize([run('chunk', 5), run('chunk', 5)])).toBe(4);
    });

    it('never opens below one word or above the maximum', () => {
        expect(startingChunkSize([run('chunk', 1), run('chunk', 1)])).toBe(CHUNK_MIN_WORDS);
        expect(startingChunkSize([run('chunk', 9), run('chunk', 9)])).toBeLessThanOrEqual(CHUNK_MAX_WORDS);
    });

    it('leaves room to climb within the round count', () => {
        const wide = startingChunkSize([run('chunk', 7), run('chunk', 7)]);
        expect(wide).toBeLessThan(CHUNK_MAX_WORDS);
    });
});
