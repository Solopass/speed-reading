import { todayKey } from './stats';
import { finiteOr } from './num';

/**
 * Each drill trains one measurable constraint on reading speed.
 *
 *   peripheral - perceptual span: the shortest flash you can still read.
 *   chunk      - how many words you take in per fixation. The single biggest
 *                lever on speed, since words-per-fixation multiplies directly
 *                into words-per-minute.
 *   schulte    - attention spread across a grid without moving your eyes.
 *   scanning   - visual search: locating a target without reading.
 *
 * Direction differs, so it is declared rather than assumed: fewer milliseconds
 * is better, more words per fixation is better.
 */
export const DRILL_META = {
    peripheral: { label: 'Peripheral Expansion', unit: 'ms', lowerIsBetter: true },
    chunk: { label: 'Chunk Perception', unit: ' words', lowerIsBetter: false },
    schulte: { label: 'Schulte Table', unit: 's', lowerIsBetter: true },
    scanning: { label: 'Target Scanning', unit: 's', lowerIsBetter: true }
};

export const DRILL_KINDS = Object.keys(DRILL_META);

export const PERIPHERAL_ROUNDS = 8;
export const PERIPHERAL_START_MS = 400;
export const PERIPHERAL_FLOOR_MS = 60;
export const PERIPHERAL_CEILING_MS = 900;

export const CHUNK_ROUNDS = 8;
export const CHUNK_START_WORDS = 2;
export const CHUNK_MIN_WORDS = 1;
export const CHUNK_MAX_WORDS = 7;
export const CHUNK_FLASH_MS = 320;

export const SCHULTE_SIZE = 5;

/** Four drills now share this history, so it holds proportionally more. */
export const MAX_DRILL_HISTORY = 200;

const clampFlash = (ms) => Math.min(PERIPHERAL_CEILING_MS, Math.max(PERIPHERAL_FLOOR_MS, Math.round(ms)));

/**
 * An adaptive staircase rather than a fixed ramp: shorten the flash after a
 * hit, lengthen it further after a miss. Converges on the threshold where you
 * are right about half the time, which is the number actually worth tracking.
 */
export function nextFlashMs(currentMs, wasCorrect) {
    return clampFlash(wasCorrect ? currentMs * 0.75 : currentMs * 1.4);
}

/** The shortest flash read correctly, or null if none were. */
export function peripheralThreshold(rounds) {
    const hits = rounds.filter(r => r.correct).map(r => r.flashMs);
    return hits.length ? Math.min(...hits) : null;
}

/** One more word after a hit, one fewer after a miss. */
export const nextChunkSize = (current, wasCorrect) =>
    Math.min(CHUNK_MAX_WORDS, Math.max(CHUNK_MIN_WORDS, current + (wasCorrect ? 1 : -1)));

/** The widest chunk recalled correctly, or null if none were. */
export function chunkThreshold(rounds) {
    const hits = rounds.filter(r => r.correct).map(r => r.size);
    return hits.length ? Math.max(...hits) : null;
}

// --- Adaptive starting points ----------------------------------------------

/** Runs to average over, and the fewest that may set a starting point. */
export const START_WINDOW = 3;
export const MIN_RUNS_TO_ADAPT = 2;

/**
 * The mean of your last few results, or null when there are too few to trust.
 *
 * The all-time best would be the wrong number here: one lucky round would make
 * every later session open above your real threshold and stay there.
 */
function recentMean(history, kind, window = START_WINDOW) {
    const runs = history
        .filter(d => d.kind === kind && typeof d.metric === 'number')
        .slice(-window);
    if (runs.length < MIN_RUNS_TO_ADAPT) return null;
    return runs.reduce((sum, d) => sum + d.metric, 0) / runs.length;
}

/**
 * Opens the drill near where you left off rather than from scratch. Starting
 * at 400ms when your threshold is 90ms spends five of the eight rounds just
 * walking back down, and the staircase only measures anything near the edge.
 *
 * One step to the easy side of your recent threshold, so round one is winnable
 * and the run does not open on a guaranteed miss.
 */
export function startingFlashMs(history) {
    const recent = recentMean(history, 'peripheral');
    if (recent === null) return PERIPHERAL_START_MS;
    return clampFlash(recent / 0.75);
}

/** Same idea for chunk width: one word narrower than you have been managing. */
export function startingChunkSize(history) {
    const recent = recentMean(history, 'chunk');
    if (recent === null) return CHUNK_START_WORDS;
    return Math.min(CHUNK_MAX_WORDS, Math.max(CHUNK_MIN_WORDS, Math.round(recent) - 1));
}

export function createDrillResult({ kind, metric, detail = null }) {
    return { kind, metric, detail, date: todayKey() };
}

export const drillsOfKind = (history, kind) => history.filter(d => d.kind === kind);

/** "Best" respects each drill's direction. */
export function bestMetric(history, kind) {
    const runs = drillsOfKind(history, kind).filter(d => typeof d.metric === 'number');
    if (!runs.length) return null;
    const values = runs.map(d => d.metric);
    return DRILL_META[kind]?.lowerIsBetter === false ? Math.max(...values) : Math.min(...values);
}

export function latestMetric(history, kind) {
    const runs = drillsOfKind(history, kind).filter(d => typeof d.metric === 'number');
    return runs.length ? runs[runs.length - 1].metric : null;
}

/**
 * Change between the first and last few runs as a percentage, signed so that
 * negative always means "improving" regardless of the drill's direction.
 */
export function drillTrend(history, kind, window = 3) {
    const runs = drillsOfKind(history, kind).filter(d => typeof d.metric === 'number');
    if (runs.length < window * 2) return null;

    const mean = (xs) => xs.reduce((sum, n) => sum + n, 0) / xs.length;
    const first = mean(runs.slice(0, window).map(d => d.metric));
    const last = mean(runs.slice(-window).map(d => d.metric));
    if (first === 0) return null;

    const change = Math.round(((last - first) / first) * 100);
    return DRILL_META[kind]?.lowerIsBetter === false ? -change : change;
}

export function migrateDrills(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(d => d && DRILL_KINDS.includes(d.kind) && finiteOr(d.metric, null) !== null)
        .map(d => ({
            kind: d.kind,
            metric: Number(d.metric),
            detail: d.detail ?? null,
            date: typeof d.date === 'string' ? d.date : todayKey()
        }))
        .slice(-MAX_DRILL_HISTORY);
}
