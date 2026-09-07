import { describe, expect, it } from 'vitest';
import { BACKUP_VERSION, backupFilename, createBackup, describeBackup, readBackup } from './backup';
import { DEFAULT_STATS } from './stats';
import { createPlan, createStep, toggleStep } from './plans';

const DEFAULTS = { goalWpm: 2000, useGeminiApi: true, baseWpm: 300, chunkSize: 1 };

const profile = {
    settings: { ...DEFAULTS, chunkSize: 3 },
    stats: { ...DEFAULT_STATS, targetWpm: 420, baselineWpm: 304, baselineDate: '2026-09-01' },
    history: [{ id: 'S1', wpm: 400, comprehension: 80, scored: true, effectiveWpm: 320 }],
    library: [{ id: 'p1', title: 'Saved', source: 'ai', kind: 'read', text: 'a b c', questions: [], attempts: [] }],
    drills: [{ kind: 'peripheral', metric: 220, date: '2026-09-02' }]
};

const roundTrip = (p = profile) => JSON.parse(JSON.stringify(createBackup(p)));

describe('createBackup', () => {
    it('stamps the payload so it can be identified later', () => {
        const backup = createBackup(profile);
        expect(backup.app).toBe('speed-ai-reading-trainer');
        expect(backup.version).toBe(BACKUP_VERSION);
        expect(backup.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('carries every section that would otherwise be lost', () => {
        const backup = createBackup(profile);
        expect(Object.keys(backup)).toEqual(
            expect.arrayContaining(['settings', 'stats', 'history', 'library', 'drills'])
        );
    });
});

describe('backupFilename', () => {
    it('is dated and unambiguous', () => {
        expect(backupFilename(new Date(2026, 8, 5))).toBe('speed-reading-backup-2026-09-05.json');
    });
});

describe('describeBackup', () => {
    it('summarises what is about to replace the profile', () => {
        const summary = describeBackup(roundTrip());
        expect(summary).toMatchObject({ sessions: 1, passages: 1, drills: 1, baselineWpm: 304, targetWpm: 420 });
    });

    it('rejects files that are not backups, before anything is overwritten', () => {
        expect(() => describeBackup(null)).toThrow(/does not contain a backup/);
        expect(() => describeBackup([1, 2, 3])).toThrow(/does not contain a backup/);
        expect(() => describeBackup({ some: 'json' })).toThrow(/not a Speed AI backup/);
    });

    it('refuses a backup from a future version rather than mangling it', () => {
        expect(() => describeBackup({ ...roundTrip(), version: BACKUP_VERSION + 1 })).toThrow(/newer version/);
    });

    it('accepts the current and older versions', () => {
        expect(() => describeBackup({ ...roundTrip(), version: BACKUP_VERSION })).not.toThrow();
        expect(() => describeBackup({ ...roundTrip(), version: 0 })).not.toThrow();
    });
});

describe('readBackup', () => {
    it('round-trips a profile intact', () => {
        const restored = readBackup(roundTrip(), DEFAULTS);
        expect(restored.stats.targetWpm).toBe(420);
        expect(restored.stats.baselineWpm).toBe(304);
        expect(restored.history).toHaveLength(1);
        expect(restored.library).toHaveLength(1);
        expect(restored.drills).toHaveLength(1);
        expect(restored.settings.chunkSize).toBe(3);
    });

    // A backup written before a setting existed must not leave it undefined.
    it('fills in settings the backup predates', () => {
        const older = roundTrip({ ...profile, settings: { baseWpm: 250 } });
        const restored = readBackup(older, DEFAULTS);
        expect(restored.settings.baseWpm).toBe(250);
        expect(restored.settings.goalWpm).toBe(DEFAULTS.goalWpm);
    });

    it('degrades a partial file to defaults rather than corrupting the profile', () => {
        const partial = { app: 'speed-ai-reading-trainer', version: 1, stats: null, history: 'nonsense', library: null, drills: undefined };
        const restored = readBackup(partial, DEFAULTS);
        expect(restored.stats).toEqual(DEFAULT_STATS);
        expect(restored.history).toEqual([]);
        expect(restored.library).toEqual([]);
        expect(restored.drills).toEqual([]);
    });

    it('runs imported data through the same migrations as stored data', () => {
        // A null baseline must survive the trip as null, not become 150.
        const fresh = roundTrip({ ...profile, stats: { ...DEFAULT_STATS } });
        expect(readBackup(fresh, DEFAULTS).stats.baselineWpm).toBeNull();
    });

    it('throws on a non-backup instead of returning empty state', () => {
        expect(() => readBackup({ some: 'json' }, DEFAULTS)).toThrow();
    });
});


describe('training plans in a backup', () => {
    const plan = createPlan({ name: 'Week one', steps: [createStep('push', 'go'), createStep('chunk', 'then this')] });

    it('carries plans, so a restore does not silently lose them', () => {
        const backup = createBackup({
            settings: {}, stats: {}, history: [], library: [], drills: [], plans: [plan]
        });
        const restored = readBackup(JSON.parse(JSON.stringify(backup)), {});
        expect(restored.plans).toHaveLength(1);
        expect(restored.plans[0].name).toBe('Week one');
        expect(restored.plans[0].steps.map(s => s.kind)).toEqual(['push', 'chunk']);
    });

    it('keeps your own progress through a restore', () => {
        const ticked = toggleStep(plan, plan.steps[0].id);
        const backup = createBackup({
            settings: {}, stats: {}, history: [], library: [], drills: [], plans: [ticked]
        });
        const restored = readBackup(JSON.parse(JSON.stringify(backup)), {});
        expect(restored.plans[0].completed).toHaveLength(1);
    });

    it('counts them in the preview shown before overwriting', () => {
        const backup = createBackup({
            settings: {}, stats: {}, history: [], library: [], drills: [], plans: [plan, createPlan()]
        });
        expect(describeBackup(backup).plans).toBe(2);
    });

    // Backups written before plans existed have no such key.
    it('reads an older backup as having no plans rather than failing', () => {
        const backup = createBackup({ settings: {}, stats: {}, history: [], library: [], drills: [] });
        delete backup.plans;
        expect(readBackup(backup, {}).plans).toEqual([]);
        expect(describeBackup(backup).plans).toBe(0);
    });
});
