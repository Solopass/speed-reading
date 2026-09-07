import { finiteOr } from './num';

// Drill speeds are their own range, deliberately wider than the recorded-session
// clamp: push phases run past the normal 2000 ceiling because their whole job is
// to make the target pace feel slow afterwards, and they are never recorded.
export const DRILL_WPM_MIN = 100;
export const DRILL_WPM_MAX = 3000;

/**
 * How hard the overload phases push, as a multiplier on their own multipliers.
 * 1.0 is the textbook 2x/3x. The range either side exists because a fixed
 * overload assumes everyone copes with the same load, which is the same
 * mistake a fixed target speed would be.
 */
export const PUSH_INTENSITY_MIN = 0.6;
export const PUSH_INTENSITY_MAX = 1.6;
export const DEFAULT_PUSH_INTENSITY = 1;

export const clampIntensity = (value) => {
    const n = finiteOr(value, DEFAULT_PUSH_INTENSITY);
    return Math.round(Math.min(PUSH_INTENSITY_MAX, Math.max(PUSH_INTENSITY_MIN, n)) * 100) / 100;
};

/**
 * The classic speed-push cycle. Sections A and B are consecutive passages on
 * the same topic: A is drilled three times at escalating speed, then B — which
 * you have not seen — is read once at a stretch pace and quizzed.
 *
 * Only the final phase is measured. The three that precede it exist to reset
 * what "fast" feels like, so the stretch pace reads as comfortable rather than
 * frantic.
 */
export const PUSH_PHASES = [
    {
        key: 'warmup',
        label: 'Warm-up',
        multiplier: 1,
        section: 'a',
        blurb: 'Read this section normally, at your usual target pace.',
        instruction: 'Follow the cursor and read for comprehension. This is your reference point.'
    },
    {
        key: 'push',
        label: 'Push',
        multiplier: 2,
        overload: true,
        section: 'a',
        blurb: 'Same text, well beyond your reading pace.',
        instruction: 'You will not catch every word, and you are not meant to. Keep your eyes moving with the cursor and do not stop to recover a phrase.'
    },
    {
        key: 'blast',
        label: 'Blast',
        multiplier: 3,
        overload: true,
        section: 'a',
        blurb: 'Same text once more, past any speed you could read at.',
        instruction: 'Do not try to read. Track the cursor and let the words register as shapes. This phase exists purely to stretch your visual span.'
    },
    {
        key: 'measure',
        label: 'Measured Read',
        multiplier: 1.3,
        section: 'b',
        blurb: 'New material, slightly above your target pace.',
        instruction: 'Read this for comprehension. After the three passes above, this pace should feel far more manageable than it would have cold. This is the read that counts.',
        measured: true
    }
];

/**
 * Only the overload phases scale. The measured read's 1.3x is the constant the
 * whole protocol is calibrated against, and the target speed it multiplies is
 * already adapting — letting both move would leave two loops chasing each other
 * and nothing comparable between one session and the next.
 */
export const phaseMultiplier = (phase, intensity = DEFAULT_PUSH_INTENSITY) =>
    phase.overload
        ? Math.round((1 + (phase.multiplier - 1) * clampIntensity(intensity)) * 100) / 100
        : phase.multiplier;

export const phaseWpm = (targetWpm, phase, intensity = DEFAULT_PUSH_INTENSITY) =>
    Math.min(DRILL_WPM_MAX, Math.max(DRILL_WPM_MIN, Math.round(targetWpm * phaseMultiplier(phase, intensity))));

/**
 * What the phase will actually run at relative to the target, after the drill
 * ceiling. Displaying the requested multiplier instead would announce a blast
 * as 4x when the clamp is holding it at 3x.
 */
export const achievedMultiplier = (targetWpm, phase, intensity = DEFAULT_PUSH_INTENSITY) => {
    if (!(targetWpm > 0)) return phaseMultiplier(phase, intensity);
    return Math.round((phaseWpm(targetWpm, phase, intensity) / targetWpm) * 10) / 10;
};

/**
 * Adapts the overload after a measured read, on the same evidence the target
 * speed uses: the comprehension score of the unseen section. The overload
 * phases exist to make the stretch pace feel manageable, so scoring well is
 * evidence they did their job and there is room for more.
 *
 * It climbs in half-steps and falls in whole ones, because the target speed is
 * moving on this same signal and the two compound: a perfect quiz already
 * raises every phase's absolute pace by 5% before the multiplier moves at all.
 */
export function nextPushIntensity(current, score) {
    const base = clampIntensity(current);
    if (typeof score !== 'number' || !Number.isFinite(score)) return base;
    if (score >= 90) return clampIntensity(base + 0.05);
    if (score >= 70) return base;
    if (score >= 50) return clampIntensity(base - 0.1);
    return clampIntensity(base - 0.2);
}

/** A word for the current load, so the number is never shown without meaning. */
export function intensityLabel(intensity) {
    const value = clampIntensity(intensity);
    if (value >= 1.3) return 'heavy';
    if (value > 1.05) return 'raised';
    if (value >= 0.95) return 'standard';
    if (value > 0.75) return 'eased';
    return 'gentle';
}

const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;

// Below this a section is too short to pace meaningfully or to quiz on.
export const MIN_SECTION_WORDS = 60;

/**
 * Splits arbitrary text into two sections of roughly equal length, preferring
 * paragraph boundaries and falling back to sentence boundaries. Returns null
 * when either half would be too short to drill on.
 */
export function splitPassage(text) {
    const paragraphs = text.trim().split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

    let sectionA, sectionB;

    if (paragraphs.length >= 2) {
        const counts = paragraphs.map(wordCount);
        const total = counts.reduce((sum, n) => sum + n, 0);
        let running = 0;
        let bestIndex = 1;
        let bestGap = Infinity;

        for (let i = 1; i < paragraphs.length; i++) {
            running += counts[i - 1];
            const gap = Math.abs(running - (total - running));
            if (gap < bestGap) { bestGap = gap; bestIndex = i; }
        }

        sectionA = paragraphs.slice(0, bestIndex).join('\n\n');
        sectionB = paragraphs.slice(bestIndex).join('\n\n');
    } else {
        const sentences = text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
        if (sentences.length < 4) return null;
        const mid = Math.ceil(sentences.length / 2);
        sectionA = sentences.slice(0, mid).join(' ');
        sectionB = sentences.slice(mid).join(' ');
    }

    if (wordCount(sectionA) < MIN_SECTION_WORDS || wordCount(sectionB) < MIN_SECTION_WORDS) return null;
    return { sectionA, sectionB };
}
