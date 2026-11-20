import { describe, expect, it } from 'vitest';
import {
    advanceByCost, gradientAnchors, gradientBackground, isFunctionWord, layoutLines, pacingCosts, textLooks
} from './textColor';

describe('layoutLines', () => {
    it('groups boxes into lines and gives x as a fraction of the width', () => {
        const boxes = [
            { top: 0, left: 0, right: 50 }, { top: 1, left: 60, right: 100 },
            { top: 30, left: 0, right: 40 }, null, { top: 30, left: 50, right: 200 }
        ];
        const out = layoutLines(boxes, 200);
        expect(out.map(o => o?.line)).toEqual([0, 0, 1, undefined, 1]);
        expect(out[1]).toEqual({ line: 0, x0: 0.3, x1: 0.5 });
        expect(out[4].x1).toBe(1);
    });
});

describe('line gradient', () => {
    it('each line starts in the colour the previous one ended in', () => {
        const anchors = gradientAnchors('classic', 0.7);
        const end0 = gradientBackground({ line: 0, x0: 1, x1: 1 }, anchors);
        const start1 = gradientBackground({ line: 1, x0: 0, x1: 0 }, anchors);
        const colourOf = (bg) => bg.match(/linear-gradient\(90deg, (.*), \1\)$/)?.[1];
        expect(colourOf(end0)).toBe(anchors[1]);
        expect(colourOf(start1)).toBe(anchors[1]);
    });

    it('cycles through text, A, text, B so neighbouring lines differ', () => {
        const a = gradientAnchors('classic', 1);
        expect(a[0]).toBe('var(--reading-fg)');
        expect(a[2]).toBe('var(--reading-fg)');
        expect(a[1]).toContain('#3b82f6');
        expect(a[3]).toContain('#ef4444');
    });
});

describe('textLooks', () => {
    const text = 'When the rain finally stopped, everyone went outside. It was cold.';

    it('alternates colours by phrase, the same colour within a phrase', () => {
        const looks = textLooks(text, { mode: 'phrases', phraseWords: 5 });
        expect(looks[0].color).toBe(looks[4].color);   // "When the rain finally stopped,"
        expect(looks[5].color).not.toBe(looks[4].color);
    });

    it('alternates colours by sentence', () => {
        const looks = textLooks(text, { mode: 'sentences' });
        expect(looks[0].color).toBe(looks[7].color);
        expect(looks[8].color).not.toBe(looks[7].color);
    });

    it('marks function words to fade only when asked', () => {
        expect(textLooks('the rain of spring', { fadeFunctionWords: true }).map(l => l.fade)).toEqual([true, false, true, false]);
        expect(textLooks('the rain', {}).some(l => l.fade)).toBe(false);
    });

    it('isFunctionWord ignores case and punctuation', () => {
        expect(isFunctionWord('"The')).toBe(true);
        expect(isFunctionWord('and,')).toBe(true);
        expect(isFunctionWord('river')).toBe(false);
    });
});

describe('smart pacing', () => {
    it('costs average 1 and punctuation costs more', () => {
        const c = pacingCosts(['a', 'cat', 'sat.'], [1, 1, 1], [0, 0, 1]);
        expect(c.reduce((s, x) => s + x, 0) / c.length).toBeCloseTo(1, 6);
        expect(c[2]).toBeGreaterThan(c[1]);
    });

    it('advanceByCost spends the budget word by word', () => {
        expect(advanceByCost(0, 1, [1, 1, 1])).toBeCloseTo(1);
        expect(advanceByCost(0, 1, [2, 1])).toBeCloseTo(0.5);
        expect(advanceByCost(0.5, 2, [2, 1, 1])).toBeCloseTo(2);
        expect(advanceByCost(2.5, 10, [1, 1, 1])).toBe(3);
    });

    it('over the whole passage it takes as long as plain pacing', () => {
        const costs = pacingCosts(['a', 'b.', 'c', 'd,'], [0.8, 1.2, 1, 1], [0, 1, 0, 0.45]);
        let p = 0;
        let steps = 0;
        while (p < 4 && steps < 1000) { p = advanceByCost(p, 0.01, costs); steps += 1; }
        expect(steps).toBeGreaterThanOrEqual(399);
        expect(steps).toBeLessThanOrEqual(401);
    });
});
