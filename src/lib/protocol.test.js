import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PUSH_INTENSITY, DRILL_WPM_MAX, DRILL_WPM_MIN, MIN_SECTION_WORDS,
    PUSH_INTENSITY_MAX, PUSH_INTENSITY_MIN, PUSH_PHASES, achievedMultiplier, clampIntensity,
    intensityLabel, nextPushIntensity, phaseMultiplier, phaseWpm, splitPassage
} from './protocol';

const words = (n, word = 'word') => Array.from({ length: n }, () => word).join(' ');
const countWords = (text) => text.trim().split(/\s+/).length;

describe('PUSH_PHASES', () => {
    it('escalates over section A then measures unseen section B', () => {
        expect(PUSH_PHASES.map(p => p.section)).toEqual(['a', 'a', 'a', 'b']);
        expect(PUSH_PHASES.map(p => p.multiplier)).toEqual([1, 2, 3, 1.3]);
    });

    it('measures exactly one phase, and it is the last', () => {
        const measured = PUSH_PHASES.filter(p => p.measured);
        expect(measured).toHaveLength(1);
        expect(measured[0]).toBe(PUSH_PHASES[PUSH_PHASES.length - 1]);
    });

    // The whole premise: the read that counts is faster than the warm-up, and
    // slower than the over-speed passes that made it feel easy.
    it('measures above the warm-up pace but below the blast', () => {
        const [warmup, , blast, measure] = PUSH_PHASES;
        expect(measure.multiplier).toBeGreaterThan(warmup.multiplier);
        expect(measure.multiplier).toBeLessThan(blast.multiplier);
    });
});

describe('phaseWpm', () => {
    it('scales each phase off the target', () => {
        expect(PUSH_PHASES.map(p => phaseWpm(304, p))).toEqual([304, 608, 912, 395]);
    });

    it('clamps a blast from a high target to the drill ceiling', () => {
        expect(phaseWpm(1000, PUSH_PHASES[2])).toBe(DRILL_WPM_MAX);
        expect(phaseWpm(2000, PUSH_PHASES[2])).toBe(DRILL_WPM_MAX);
    });

    it('holds the drill floor', () => {
        expect(phaseWpm(10, PUSH_PHASES[0])).toBe(DRILL_WPM_MIN);
    });

    it('allows drill speeds above the recorded-session ceiling', () => {
        expect(DRILL_WPM_MAX).toBeGreaterThan(2000);
    });
});

describe('splitPassage', () => {
    it('splits on the most balanced paragraph boundary', () => {
        const text = `${words(100)}\n\n${words(100)}\n\n${words(100)}\n\n${words(100)}`;
        const { sectionA, sectionB } = splitPassage(text);
        expect(countWords(sectionA)).toBe(200);
        expect(countWords(sectionB)).toBe(200);
    });

    it('picks the closest boundary when paragraphs are uneven', () => {
        const text = `${words(20)}\n\n${words(200)}\n\n${words(180)}`;
        const { sectionA, sectionB } = splitPassage(text);
        // 220/180 beats 20/380.
        expect(countWords(sectionA)).toBe(220);
        expect(countWords(sectionB)).toBe(180);
    });

    it('falls back to sentence boundaries for a single paragraph', () => {
        const text = Array.from({ length: 10 }, () => `${words(20)}.`).join(' ');
        const result = splitPassage(text);
        expect(result).not.toBeNull();
        expect(countWords(result.sectionA)).toBeGreaterThanOrEqual(MIN_SECTION_WORDS);
        expect(countWords(result.sectionB)).toBeGreaterThanOrEqual(MIN_SECTION_WORDS);
    });

    it('refuses text too short to drill on', () => {
        expect(splitPassage('One two. Three four.')).toBeNull();
        expect(splitPassage(words(50))).toBeNull();
        expect(splitPassage(`${words(200)}\n\n${words(5)}`)).toBeNull();
    });

    it('loses no words in the split', () => {
        const text = `${words(90)}\n\n${words(110)}`;
        const { sectionA, sectionB } = splitPassage(text);
        expect(countWords(sectionA) + countWords(sectionB)).toBe(200);
    });
});


describe('push intensity', () => {
    const [warmup, push, blast, measure] = PUSH_PHASES;

    it('leaves the phases at their textbook multipliers by default', () => {
        expect(PUSH_PHASES.map(p => phaseMultiplier(p, DEFAULT_PUSH_INTENSITY)))
            .toEqual([1, 2, 3, 1.3]);
    });

    it('scales only the overload phases', () => {
        expect(PUSH_PHASES.filter(p => p.overload).map(p => p.key)).toEqual(['push', 'blast']);
        expect(phaseMultiplier(push, 1.5)).toBe(2.5);
        expect(phaseMultiplier(blast, 1.5)).toBe(4);
        // The reference pace and the measured read are fixed points.
        expect(phaseMultiplier(warmup, 1.5)).toBe(1);
        expect(phaseMultiplier(measure, 1.5)).toBe(1.3);
        expect(phaseMultiplier(measure, 0.6)).toBe(1.3);
    });

    it('eases the overload below the textbook figures', () => {
        expect(phaseMultiplier(push, 0.6)).toBe(1.6);
        expect(phaseMultiplier(blast, 0.6)).toBe(2.2);
    });

    // An overload phase must never drop to or below the reference pace, or the
    // drill stops being a drill.
    it('stays above the warm-up even at the gentlest setting', () => {
        expect(phaseMultiplier(push, PUSH_INTENSITY_MIN)).toBeGreaterThan(1);
        expect(phaseMultiplier(blast, PUSH_INTENSITY_MIN)).toBeGreaterThan(phaseMultiplier(push, PUSH_INTENSITY_MIN));
    });

    it('feeds through to the paced speed', () => {
        expect(phaseWpm(300, push, 1)).toBe(600);
        expect(phaseWpm(300, push, 1.5)).toBe(750);
        expect(phaseWpm(300, push, 0.6)).toBe(480);
    });

    it('defaults to the standard load when no intensity is given', () => {
        expect(phaseWpm(300, push)).toBe(phaseWpm(300, push, DEFAULT_PUSH_INTENSITY));
    });
});

describe('clampIntensity', () => {
    it('holds the range', () => {
        expect(clampIntensity(9)).toBe(PUSH_INTENSITY_MAX);
        expect(clampIntensity(0)).toBe(PUSH_INTENSITY_MIN);
    });

    // finiteOr, not Number(): a stored null would otherwise clamp to the floor
    // and silently gut the drill for anyone upgrading.
    it('falls back to standard rather than the floor for missing values', () => {
        expect(clampIntensity(null)).toBe(DEFAULT_PUSH_INTENSITY);
        expect(clampIntensity(undefined)).toBe(DEFAULT_PUSH_INTENSITY);
        expect(clampIntensity('')).toBe(DEFAULT_PUSH_INTENSITY);
        expect(clampIntensity('nonsense')).toBe(DEFAULT_PUSH_INTENSITY);
    });

    it('rounds off floating-point dust from repeated steps', () => {
        expect(clampIntensity(1.0500000000000003)).toBe(1.05);
    });
});

describe('nextPushIntensity', () => {
    it('raises the load when the measured read still went well', () => {
        expect(nextPushIntensity(1, 100)).toBe(1.05);
        expect(nextPushIntensity(1, 90)).toBe(1.05);
    });

    it('holds through the training band', () => {
        expect(nextPushIntensity(1, 80)).toBe(1);
        expect(nextPushIntensity(1, 70)).toBe(1);
    });

    it('eases off when retention slips, harder when it collapses', () => {
        expect(nextPushIntensity(1, 60)).toBe(0.9);
        expect(nextPushIntensity(1, 20)).toBe(0.8);
    });

    // It climbs slower than it falls because targetWpm is moving on this same
    // score, so every phase already gets 5% faster before the multiplier moves.
    it('climbs in smaller steps than it falls', () => {
        const up = nextPushIntensity(1, 100) - 1;
        const down = 1 - nextPushIntensity(1, 60);
        expect(up).toBeLessThan(down);
    });

    it('never leaves the range, however long the run', () => {
        let high = 1;
        let low = 1;
        for (let i = 0; i < 40; i++) {
            high = nextPushIntensity(high, 100);
            low = nextPushIntensity(low, 0);
        }
        expect(high).toBe(PUSH_INTENSITY_MAX);
        expect(low).toBe(PUSH_INTENSITY_MIN);
    });

    // An unscored push is no evidence either way.
    it('holds when there was no quiz', () => {
        expect(nextPushIntensity(1.2, null)).toBe(1.2);
        expect(nextPushIntensity(1.2, undefined)).toBe(1.2);
        expect(nextPushIntensity(1.2, NaN)).toBe(1.2);
    });
});

describe('achievedMultiplier', () => {
    it('matches the requested multiplier below the ceiling', () => {
        expect(achievedMultiplier(300, PUSH_PHASES[2], 1)).toBe(3);
    });

    // Announcing a 4x blast that the ceiling is actually running at 2x would be
    // a lie on screen.
    it('reports what the ceiling allows, not what was asked for', () => {
        expect(phaseWpm(1500, PUSH_PHASES[2], 1.6)).toBe(DRILL_WPM_MAX);
        expect(achievedMultiplier(1500, PUSH_PHASES[2], 1.6)).toBe(2);
    });

    it('does not divide by zero', () => {
        expect(Number.isFinite(achievedMultiplier(0, PUSH_PHASES[1], 1))).toBe(true);
    });
});

describe('intensityLabel', () => {
    it('names every point in the range', () => {
        expect(intensityLabel(1)).toBe('standard');
        expect(intensityLabel(1.6)).toBe('heavy');
        expect(intensityLabel(1.15)).toBe('raised');
        expect(intensityLabel(0.85)).toBe('eased');
        expect(intensityLabel(0.6)).toBe('gentle');
    });
});
