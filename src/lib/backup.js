import { migrateHistory, migrateStats, todayKey } from './stats';
import { migrateLibrary } from './library';
import { migrateDrills } from './drillStats';
import { migratePlans } from './plans';

// Everything lives in localStorage for one browser profile, which means a
// cleared cache, a new machine, or a different browser loses the lot. These
// functions are the escape hatch.

export const BACKUP_VERSION = 1;

export function createBackup({ settings, stats, history, library, drills, plans = [] }) {
    return {
        app: 'speed-ai-reading-trainer',
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        settings,
        stats,
        history,
        library,
        drills,
        plans
    };
}

export const backupFilename = (date = new Date()) => `speed-reading-backup-${todayKey(date)}.json`;

/**
 * A summary to show before overwriting anything. Importing replaces the current
 * profile outright, so the user should be able to see what they are about to
 * swap in — and find out here, rather than after, that a file is not a backup.
 */
export function describeBackup(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('That file does not contain a backup.');
    }
    if (parsed.app !== 'speed-ai-reading-trainer') {
        throw new Error('That JSON is not a Speed AI backup.');
    }
    if (Number(parsed.version) > BACKUP_VERSION) {
        throw new Error(`That backup was written by a newer version (v${parsed.version}). Update the app first.`);
    }

    const stats = migrateStats(parsed.stats);
    return {
        exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt.slice(0, 10) : 'unknown date',
        sessions: migrateHistory(parsed.history).length,
        passages: migrateLibrary(parsed.library).length,
        drills: migrateDrills(parsed.drills).length,
        plans: migratePlans(parsed.plans).length,
        baselineWpm: stats.baselineWpm,
        targetWpm: stats.targetWpm
    };
}

/**
 * Runs every section through the same migrations used when reading
 * localStorage, so a hand-edited or partial file degrades to sane defaults
 * instead of corrupting the profile.
 */
export function readBackup(parsed, defaultSettings) {
    describeBackup(parsed);
    return {
        settings: { ...defaultSettings, ...(parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}) },
        stats: migrateStats(parsed.stats),
        history: migrateHistory(parsed.history),
        library: migrateLibrary(parsed.library),
        drills: migrateDrills(parsed.drills),
        // Absent in v1 backups, which predate plans — an empty list, not a loss.
        plans: migratePlans(parsed.plans)
    };
}

/** Triggers a download of the backup as a JSON file. */
export function downloadBackup(backup) {
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = backupFilename();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}
