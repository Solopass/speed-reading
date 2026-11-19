// Three distinct numbers were previously conflated under "WPM". They are:
//
//   targetWpm    - the prescription. What the reader opens at next time.
//                  This is what adapts based on how you score.
//   effectiveWpm - a measurement. raw WPM x comprehension, per session.
//                  Never stored as a mutable stat; always derived from history.
//   baseWpm      - a manual override in settings, used only when adaptation is off.

import { finiteOr } from './num';
import { DEFAULT_PUSH_INTENSITY, clampIntensity } from './protocol';

export const WPM_MIN = 150;
export const WPM_MAX = 2000;

export const DEFAULT_STATS = {
    targetWpm: 300,
    highestWpm: 300,
    streak: 0,
    sessionsCompleted: 0,
    lastSessionDate: null, // 'YYYY-MM-DD'
    // Set once by the baseline test. Until then the 300 above is a guess, and
    // "progress" has no zero point to measure from.
    baselineWpm: null,
    baselineComprehension: null,
    baselineDate: null,
    // How hard the speed-push overload phases run. Adapts on the same evidence
    // as targetWpm, but is a separate axis: how fast you should read, and how
    // much overload it takes to get you there, are different questions.
    pushIntensity: DEFAULT_PUSH_INTENSITY,
    // Up to BASELINE_SAMPLES calibration reads; the baseline is their mean, so
    // one distracted run does not set the zero point for everything after it.
    baselineSamples: [],
    // Backup bookkeeping for the reminder: when the last export happened, how
    // many sessions existed at that point, and a snooze date.
    lastBackupAt: null,
    sessionsAtBackup: 0,
    backupSnoozedUntil: null
};

/** Sessions kept in history. Each is ~200 bytes, so this is well inside localStorage. */
export const HISTORY_LIMIT = 1000;

/** Calibration passages averaged into the baseline. */
export const BASELINE_SAMPLES = 3;

export const clampWpm = (n) => Math.min(WPM_MAX, Math.max(WPM_MIN, Math.round(n)));

/** Local calendar date. Stable across locales, unlike toLocaleDateString(). */
export function todayKey(d = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysBetween(fromKey, toKey) {
    const [fy, fm, fd] = fromKey.split('-').map(Number);
    const [ty, tm, td] = toKey.split('-').map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

/** A streak survives a same-day repeat and a next-day session; any longer gap restarts it. */
export function nextStreak(prevStreak, lastDate, today) {
    if (!lastDate) return 1;
    const gap = daysBetween(lastDate, today);
    if (gap === 0) return Math.max(1, prevStreak);
    if (gap === 1) return prevStreak + 1;
    return 1;
}

/**
 * Asymmetric staircase: climb slowly when you have headroom, drop faster when
 * retention breaks down. Proportional rather than a flat +/-25 so the step
 * stays sensible at 200 and at 1000 WPM.
 *
 * The bands assume a 5-question / 4-option quiz, where guessing alone scores
 * ~25%, so they sit above a naive 50% midpoint and land cleanly on the only
 * achievable scores: 5/5 climbs, 4/5 holds, 3/5 eases off, 2/5 or worse backs
 * off hard.
 */
export function adaptTarget(targetWpm, score) {
    let factor;
    if (score >= 90) factor = 1.05;
    else if (score >= 70) factor = 1.0;
    else if (score >= 50) factor = 0.97;
    else factor = 0.92;

    // Hold means hold. Snapping to the nearest 5 would otherwise drift an
    // unchanged target by a couple of WPM on every in-band session.
    if (factor === 1) return clampWpm(targetWpm);

    return clampWpm(Math.round((targetWpm * factor) / 5) * 5);
}

/** The per-session climb a perfect quiz earns, used for goal projections. */
export const CLIMB_FACTOR = 1.05;

/**
 * Percentage change in reading speed since the baseline test, or null.
 *
 * `currentWpm` is passed in rather than read off the stats because the speed
 * actually in force is `settings.baseWpm` while adaptation is switched off.
 * Reading `targetWpm` regardless made the dashboard report a change against a
 * number the reader had stopped using.
 */
export function baselineDelta(stats, currentWpm = stats.targetWpm) {
    if (!stats.baselineWpm) return null;
    return Math.round(((currentWpm - stats.baselineWpm) / stats.baselineWpm) * 100);
}

/**
 * How many perfect sessions separate you from a goal, given the 5% climb.
 * A floor, not a forecast: it assumes you never miss a question, which nobody
 * does, so the real count is higher.
 */
export function sessionsToGoal(targetWpm, goalWpm) {
    if (targetWpm >= goalWpm) return 0;
    return Math.ceil(Math.log(goalWpm / targetWpm) / Math.log(CLIMB_FACTOR));
}

/** Progress from baseline to goal as a 0-100 percentage. */
export function goalProgress(stats, goalWpm, currentWpm = stats.targetWpm) {
    const from = stats.baselineWpm ?? DEFAULT_STATS.targetWpm;
    if (goalWpm <= from) return 100;
    return Math.max(0, Math.min(100, Math.round(((currentWpm - from) / (goalWpm - from)) * 100)));
}

/**
 * A session is "scored" only when a real comprehension quiz ran. Unscored
 * practice (custom text, no questions) still counts for the streak, but must
 * not feed comprehension or effective-WPM averages.
 */
export function createSession({ index, wpm, score, words, elapsedMs, kind = 'session', mode = null }) {
    const scored = typeof score === 'number';
    return {
        id: kind === 'baseline' ? 'Base' : `S${index}`,
        kind,
        // How it was read: 'rsvp' | 'paced' | 'natural' | 'skim' | 'push'.
        mode,
        date: todayKey(),
        wpm,
        words,
        elapsedMs,
        scored,
        comprehension: scored ? score : null,
        effectiveWpm: scored ? Math.round((wpm * score) / 100) : null
    };
}

/**
 * Quizzed reading sessions. Skims are excluded: they are scored on gist, not
 * detail, so averaging them in would inflate comprehension and eWPM alike.
 */
export const scoredSessions = (history) => history.filter((s) => s.scored && s.kind !== 'skim');

/** Quizzed skim sessions, measured on their own terms. */
export const skimSessions = (history) => history.filter((s) => s.scored && s.kind === 'skim');

export function averageComprehension(history) {
    const scored = scoredSessions(history);
    if (!scored.length) return null;
    return Math.round(scored.reduce((sum, s) => sum + s.comprehension, 0) / scored.length);
}

export function recentEffectiveWpm(history, n = 5) {
    const recent = scoredSessions(history).slice(-n);
    if (!recent.length) return null;
    return Math.round(recent.reduce((sum, s) => sum + s.effectiveWpm, 0) / recent.length);
}

export function level(history) {
    const eWpm = recentEffectiveWpm(history, 5);
    return eWpm === null ? 1 : Math.max(1, Math.floor(eWpm / 50));
}

/** Reads stats written by any earlier build, including the pre-targetWpm shape. */
export function migrateStats(raw) {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATS };
    const isoDate = typeof raw.lastSessionDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastSessionDate);
    return {
        // Older builds stored the adapting prescription under `effectiveWpm`.
        targetWpm: clampWpm(finiteOr(raw.targetWpm ?? raw.effectiveWpm, DEFAULT_STATS.targetWpm)),
        highestWpm: finiteOr(raw.highestWpm, DEFAULT_STATS.highestWpm),
        streak: Math.max(0, finiteOr(raw.streak, 0)),
        sessionsCompleted: Math.max(0, finiteOr(raw.sessionsCompleted, 0)),
        // A locale-formatted date can't be compared safely, so drop it and let
        // the streak restart rather than silently miscounting.
        lastSessionDate: isoDate ? raw.lastSessionDate : null,
        baselineWpm: finiteOr(raw.baselineWpm, null) === null ? null : clampWpm(raw.baselineWpm),
        baselineComprehension: finiteOr(raw.baselineComprehension, null),
        baselineDate: typeof raw.baselineDate === 'string' ? raw.baselineDate : null,
        pushIntensity: clampIntensity(raw.pushIntensity),
        baselineSamples: migrateSamples(raw.baselineSamples, raw.baselineWpm, raw.baselineComprehension, raw.baselineDate),
        lastBackupAt: isDateKey(raw.lastBackupAt) ? raw.lastBackupAt : null,
        sessionsAtBackup: Math.max(0, finiteOr(raw.sessionsAtBackup, 0)),
        backupSnoozedUntil: isDateKey(raw.backupSnoozedUntil) ? raw.backupSnoozedUntil : null
    };
}

const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Older builds stored a single baseline figure. Treat it as the first sample
 * so adding a second passage averages with it rather than replacing it.
 */
function migrateSamples(samples, legacyWpm, legacyScore, legacyDate) {
    if (Array.isArray(samples)) {
        return samples
            .filter((x) => x && Number.isFinite(Number(x.wpm)))
            .map((x) => ({ wpm: clampWpm(x.wpm), score: finiteOr(x.score, null), date: typeof x.date === 'string' ? x.date : null }))
            .slice(-BASELINE_SAMPLES);
    }
    if (finiteOr(legacyWpm, null) === null) return [];
    return [{ wpm: clampWpm(legacyWpm), score: finiteOr(legacyScore, null), date: typeof legacyDate === 'string' ? legacyDate : null }];
}

/**
 * Records one calibration read. `fresh` starts a new baseline (a retake);
 * otherwise the read joins the current set, up to BASELINE_SAMPLES.
 *
 * The baseline becomes the mean of the set. The target follows it on a retake,
 * and on an added passage only while it still sits at the old baseline:
 * once training has moved the target, a recalibration must not wipe that out.
 */
export function addBaselineSample(stats, { wpm, score, date = todayKey() }, { fresh = false } = {}) {
    const prior = fresh ? [] : (stats.baselineSamples ?? []);
    const samples = [...prior, { wpm: clampWpm(wpm), score: typeof score === 'number' ? score : null, date }].slice(-BASELINE_SAMPLES);
    const meanWpm = clampWpm(samples.reduce((sum, x) => sum + x.wpm, 0) / samples.length);
    const scores = samples.map((x) => x.score).filter((x) => typeof x === 'number');
    return {
        ...stats,
        baselineSamples: samples,
        baselineWpm: meanWpm,
        baselineComprehension: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
        baselineDate: date,
        targetWpm: fresh || stats.baselineWpm == null || stats.targetWpm === stats.baselineWpm ? meanWpm : stats.targetWpm
    };
}

// --- Backup reminder -------------------------------------------------------

export const BACKUP_EVERY_SESSIONS = 5;
export const BACKUP_EVERY_DAYS = 7;
export const BACKUP_SNOOZE_DAYS = 3;

/**
 * Whether to nudge for an export. Everything lives in one browser's
 * localStorage, so an unexported profile is one cleared cache from gone.
 * Never nags a brand-new profile, and never when nothing changed since the
 * last export.
 */
export function backupReminderDue(stats, today = todayKey()) {
    const since = stats.sessionsCompleted - (stats.sessionsAtBackup ?? 0);
    if (since <= 0) return false;
    if (stats.backupSnoozedUntil && daysBetween(today, stats.backupSnoozedUntil) > 0) return false;
    if (!stats.lastBackupAt) return stats.sessionsCompleted >= 3;
    return since >= BACKUP_EVERY_SESSIONS || daysBetween(stats.lastBackupAt, today) >= BACKUP_EVERY_DAYS;
}

export const markBackedUp = (stats, today = todayKey()) => ({
    ...stats, lastBackupAt: today, sessionsAtBackup: stats.sessionsCompleted, backupSnoozedUntil: null
});

export function snoozeBackup(stats, today = todayKey()) {
    const [y, m, d] = today.split('-').map(Number);
    return { ...stats, backupSnoozedUntil: todayKey(new Date(y, m - 1, d + BACKUP_SNOOZE_DAYS)) };
}

// --- Analytics -------------------------------------------------------------

/**
 * Least-squares line through (x, y) points. Returns null with fewer than two
 * distinct x values, where a slope means nothing.
 */
export function linearTrend(points) {
    const n = points.length;
    if (n < 2) return null;
    const mx = points.reduce((s, p) => s + p.x, 0) / n;
    const my = points.reduce((s, p) => s + p.y, 0) / n;
    const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    if (sxx === 0) return null;
    const slope = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
    return { slope, intercept: my - slope * mx, at: (x) => my + slope * (x - mx) };
}

/** Per-day activity for a heatmap: the last `days` days ending today, oldest first. */
export function dailyActivity(history, days = 84, today = todayKey()) {
    const counts = new Map();
    for (const s of history) {
        if (!s.date) continue;
        const entry = counts.get(s.date) ?? { sessions: 0, minutes: 0 };
        entry.sessions += 1;
        entry.minutes += (s.elapsedMs ?? 0) / 60000;
        counts.set(s.date, entry);
    }
    const [y, m, d] = today.split('-').map(Number);
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
        const key = todayKey(new Date(y, m - 1, d - i));
        const entry = counts.get(key) ?? { sessions: 0, minutes: 0 };
        out.push({ date: key, sessions: entry.sessions, minutes: Math.round(entry.minutes * 10) / 10 });
    }
    return out;
}

/** Minutes read per week (weeks start Monday), the last `weeks` weeks, oldest first. */
export function weeklyMinutes(history, weeks = 8, today = todayKey()) {
    const [y, m, d] = today.split('-').map(Number);
    const now = new Date(y, m - 1, d);
    const monday = new Date(y, m - 1, d - ((now.getDay() + 6) % 7));
    const buckets = [];
    for (let i = weeks - 1; i >= 0; i--) {
        const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * i);
        buckets.push({ week: todayKey(start), minutes: 0, sessions: 0 });
    }
    for (const s of history) {
        if (!s.date) continue;
        let idx = -1;
        for (let i = buckets.length - 1; i >= 0; i--) {
            if (buckets[i].week <= s.date) { idx = i; break; }
        }
        if (idx === -1 || daysBetween(buckets[idx].week, s.date) > 6) continue;
        buckets[idx].minutes += (s.elapsedMs ?? 0) / 60000;
        buckets[idx].sessions += 1;
    }
    return buckets.map((b) => ({ ...b, minutes: Math.round(b.minutes) }));
}

export const MODE_LABELS = { rsvp: 'RSVP', paced: 'Paced', natural: 'Natural', skim: 'Skim', push: 'Speed push' };

/** Averages per reading mode, quizzed sessions only. Sessions from before modes were recorded group as 'other'. */
export function byMode(history) {
    const groups = new Map();
    for (const s of history) {
        if (!s.scored || s.kind === 'baseline') continue;
        const key = s.kind === 'skim' ? 'skim' : (s.mode ?? 'other');
        const g = groups.get(key) ?? { mode: key, sessions: 0, wpm: 0, comprehension: 0, effectiveWpm: 0 };
        g.sessions += 1;
        g.wpm += s.wpm;
        g.comprehension += s.comprehension;
        g.effectiveWpm += s.effectiveWpm;
        groups.set(key, g);
    }
    return [...groups.values()].map((g) => ({
        mode: g.mode,
        label: MODE_LABELS[g.mode] ?? 'Other',
        sessions: g.sessions,
        wpm: Math.round(g.wpm / g.sessions),
        comprehension: Math.round(g.comprehension / g.sessions),
        effectiveWpm: Math.round(g.effectiveWpm / g.sessions)
    })).sort((a, b) => b.sessions - a.sessions);
}

/** Last `n` values of a field over quizzed reading sessions, for sparklines. */
export const recentSeries = (history, field, n = 12) =>
    scoredSessions(history).slice(-n).map((s, i) => ({ i, v: s[field] }));


export function migrateHistory(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((s) => s && Number.isFinite(Number(s.wpm)))
        .map((s, i) => {
            // finiteOr, not a bare Number.isFinite check: Number(null) is 0, so
            // an unscored legacy session would come back scored at 0%.
            const comprehension = finiteOr(s.comprehension, null);
            const scored = typeof s.scored === 'boolean' ? s.scored : comprehension !== null;
            return {
                id: s.id ?? `S${i + 1}`,
                kind: s.kind ?? 'session',
                mode: typeof s.mode === 'string' ? s.mode : null,
                date: s.date ?? null,
                wpm: Number(s.wpm),
                words: finiteOr(s.words, null),
                elapsedMs: finiteOr(s.elapsedMs, null),
                scored,
                comprehension: scored ? comprehension : null,
                effectiveWpm: scored ? Math.round((Number(s.wpm) * comprehension) / 100) : null
            };
        });
}
