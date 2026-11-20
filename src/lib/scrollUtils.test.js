import { describe, expect, it } from 'vitest';
import { groupLineTops, isHeadingParagraph, rsvpWordScale } from './scrollUtils';

describe('scrollUtils', () => {
    it('groups word vertical centers into shared visual-line centers', () => {
        const tops = [10, 11, 10.5, 42, 41.5, 43, 74];
        const grouped = groupLineTops(tops, 6);
        expect(grouped[0]).toBe(grouped[1]);
        expect(grouped[1]).toBe(grouped[2]);
        expect(grouped[0]).toBeCloseTo(10.5, 4);
        expect(grouped[3]).toBe(grouped[4]);
        expect(grouped[4]).toBe(grouped[5]);
        expect(grouped[3]).toBeCloseTo(42.1667, 3);
        expect(grouped[6]).toBe(74);
    });

    it('returns empty array for empty input in groupLineTops', () => {
        expect(groupLineTops([])).toEqual([]);
    });

    it('detects standalone chapter/section headings without flagging normal sentences', () => {
        expect(isHeadingParagraph(['Chapter', '3:', 'The', 'Storm'])).toBe(true);
        expect(isHeadingParagraph(['NEVER', 'OUTSHINE', 'THE', 'MASTER'])).toBe(true);
        expect(isHeadingParagraph(['The', 'Quiet', 'Room'])).toBe(true);
        expect(isHeadingParagraph(['He', 'walked', 'home.'])).toBe(false);
        expect(isHeadingParagraph(['One', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'])).toBe(false);
    });

    it('scales down long RSVP words while keeping normal words at 1x', () => {
        expect(rsvpWordScale('hello')).toBe(1);
        expect(rsvpWordScale('measurement')).toBe(1);
        expect(rsvpWordScale('telecommunications')).toBeLessThan(1);
        expect(rsvpWordScale('pneumonoultramicroscopicsilicovolcanoconiosis')).toBe(0.58);
    });
});
