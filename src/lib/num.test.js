import { describe, expect, it } from 'vitest';
import { clampOr, finiteOr, isBlank } from './num';

describe('isBlank', () => {
    it('treats missing values and booleans as blank', () => {
        [null, undefined, '', true, false].forEach(v => expect(isBlank(v)).toBe(true));
    });

    it('does not treat real numbers as blank, including zero', () => {
        [0, -1, 3.5, '0', '42'].forEach(v => expect(isBlank(v)).toBe(false));
    });
});

describe('finiteOr', () => {
    // The regressions this helper exists to prevent.
    it('does not turn null into 0', () => {
        expect(finiteOr(null, 'fallback')).toBe('fallback');
    });

    it('does not turn an empty string into 0', () => {
        expect(finiteOr('', 99)).toBe(99);
    });

    it('does not turn a boolean into 0 or 1', () => {
        expect(finiteOr(false, 99)).toBe(99);
        expect(finiteOr(true, 99)).toBe(99);
    });

    it('rejects NaN and Infinity', () => {
        expect(finiteOr(NaN, 7)).toBe(7);
        expect(finiteOr(Infinity, 7)).toBe(7);
        expect(finiteOr('abc', 7)).toBe(7);
    });

    it('keeps genuine values, zero included', () => {
        expect(finiteOr(0, 99)).toBe(0);
        expect(finiteOr(-4.5, 99)).toBe(-4.5);
        expect(finiteOr('42', 99)).toBe(42);
    });
});

describe('clampOr', () => {
    it('holds values inside the range', () => {
        expect(clampOr(500, [0, 100], 50)).toBe(100);
        expect(clampOr(-500, [0, 100], 50)).toBe(0);
        expect(clampOr(42, [0, 100], 50)).toBe(42);
    });

    it('uses the fallback rather than the minimum for blank input', () => {
        expect(clampOr('', [12, 44], 20)).toBe(20);
        expect(clampOr(null, [12, 44], 20)).toBe(20);
    });
});
