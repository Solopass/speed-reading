import { describe, expect, it } from 'vitest';
import { autoBackupDue, filesToPrune } from './autoBackup';
import { createBackup, readBackup } from './backup';

describe('filesToPrune', () => {
    it('keeps the newest N backups and never touches other files', () => {
        const names = [
            'speed-reading-backup-2026-11-01.json', 'notes.txt', 'speed-reading-backup-2026-11-03.json',
            'speed-reading-backup-2026-11-02.json', 'speed-reading-backup-2026-11-04.json', 'speed-reading-backup-old.txt'
        ];
        expect(filesToPrune(names, 2)).toEqual(['speed-reading-backup-2026-11-01.json', 'speed-reading-backup-2026-11-02.json']);
        expect(filesToPrune(names, 10)).toEqual([]);
        // At least one is always kept.
        expect(filesToPrune(names, 0)).toHaveLength(3);
    });
});

describe('autoBackupDue', () => {
    const now = Date.parse('2026-11-22T12:00:00Z');
    it('is due when never made, unreadable, or older than the interval', () => {
        expect(autoBackupDue(null, 24, now)).toBe(true);
        expect(autoBackupDue('garbage', 24, now)).toBe(true);
        expect(autoBackupDue('2026-11-21T11:00:00Z', 24, now)).toBe(true);
        expect(autoBackupDue('2026-11-22T06:00:00Z', 24, now)).toBe(false);
        expect(autoBackupDue('2026-11-22T06:00:00Z', 6, now)).toBe(true);
    });
});

describe('backups include reading presets', () => {
    it('round-trips custom presets, and an older backup without them reads as none', () => {
        const presets = [{ id: 'p1', name: 'Night', reading: { themeId: 'dark' } }];
        const backup = createBackup({ settings: {}, stats: {}, history: [], library: [], drills: [], presets });
        expect(backup.presets).toEqual(presets);
        expect(readBackup(JSON.parse(JSON.stringify(backup)), {}).presets).toEqual(presets);
        const { presets: _omit, ...old } = backup;
        expect(readBackup(old, {}).presets).toEqual([]);
    });
});
