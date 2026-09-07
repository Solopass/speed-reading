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
    pushIntensity: DEFAULT_PUSH_INTENSITY
};

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
export function createSession({ index, wpm, score, words, elapsedMs, kind = 'session' }) {
    const scored = typeof score === 'number';
    return {
        id: kind === 'baseline' ? 'Base' : `S${index}`,
        kind,
        date: todayKey(),
        wpm,
        words,
        elapsedMs,
        scored,
        comprehension: scored ? score : null,
        effectiveWpm: scored ? Math.round((wpm * score) / 100) : null
    };
}

export const scoredSessions = (history) => history.filter((s) => s.scored);

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
        pushIntensity: clampIntensity(raw.pushIntensity)
    };
}

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
