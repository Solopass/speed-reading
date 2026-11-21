import { describe, expect, it } from 'vitest';
import { buildLineSpans, focalRange, groupLineTops, isHeadingParagraph, orpIndex, rsvpWordScale } from './scrollUtils';

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

    it('builds continuous line-span anchors for constant smooth scroll', () => {
        const lineTops = [100, 100, 100, 130, 130, 160];
        const spans = buildLineSpans(lineTops);
        expect(spans.lineStart).toEqual([0, 0, 0, 3, 3, 5]);
        expect(spans.lineLen).toEqual([3, 3, 3, 2, 2, 1]);
        expect(spans.nextLineTop).toEqual([130, 130, 130, 160, 160, 160]);
    });

    it('computes ORP index skipping leading punctuation', () => {
        expect(orpIndex('a')).toBe(0);
        expect(orpIndex('“Hello')).toBe(2);
        expect(orpIndex('reading')).toBe(2);
    });

    it('computes focalRange for single and 3-letter cluster modes', () => {
        expect(focalRange('reading', 'single')).toEqual({ start: 2, center: 2, end: 3 });
        expect(focalRange('reading', 'cluster')).toEqual({ start: 1, center: 2, end: 4 });
    });
});
