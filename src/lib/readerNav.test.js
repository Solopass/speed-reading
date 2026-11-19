import { describe, expect, it } from 'vitest';
import { clampIndex, clock, jump, startCount, wordsCovered } from './readerNav';

describe('reader word counting', () => {
    it('counts forward from where reading started', () => {
        expect(wordsCovered(startCount(100), 150)).toBe(50);
        expect(wordsCovered(startCount(100), 90)).toBe(0);
    });

    it('banks words before a rewind and counts the re-read', () => {
        let c = startCount(0);
        c = jump(c, 80, 60);                 // read 80, rewind 20
        expect(wordsCovered(c, 100)).toBe(120); // 80 + 40 re-read and new
    });

    it('does not credit words skipped over', () => {
        let c = startCount(0);
        c = jump(c, 50, 200);
        expect(wordsCovered(c, 210)).toBe(60);
    });

    it('clamps indices and formats time', () => {
        expect(clampIndex(-5, 100)).toBe(0);
        expect(clampIndex(500, 100)).toBe(99);
        expect(clock(65)).toBe('1:05');
        expect(clock(-3)).toBe('0:00');
    });
});
