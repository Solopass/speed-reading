import { describe, expect, it } from 'vitest';
import { clampIndex, clock, extractSections, jump, startCount, wordsCovered } from './readerNav';

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

describe('extractSections', () => {
    it('extracts heading positions with Opening when text precedes the first heading', () => {
        const text = 'Intro words here.\n\nChapter 1\n\nBody one.\n\nChapter 2\n\nBody two.';
        expect(extractSections(text)).toEqual([
            { title: 'Opening', index: 0 },
            { title: 'Chapter 1', index: 3 },
            { title: 'Chapter 2', index: 7 }
        ]);
    });

    it('falls back to evenly spaced parts for long unheaded documents', () => {
        const text = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
        const sections = extractSections(text);
        expect(sections.length).toBeGreaterThanOrEqual(3);
        expect(sections[0]).toEqual({ title: 'Part 1', index: 0 });
    });

    it('returns empty for short passages without headings', () => {
        expect(extractSections('Just a short sentence.')).toEqual([]);
    });
});

describe('remapWordIndex', () => {
    it('follows a word after earlier paragraphs are cut', async () => {
        const { remapWordIndex } = await import('./readerNav');
        const oldText = 'Copyright 2020 all rights reserved\n\nThe river carried silt to the plain every spring.\n\nFarmers waited for the flood.';
        const newText = 'The river carried silt to the plain every spring.\n\nFarmers waited for the flood.';
        const oldIndex = oldText.split(/\s+/).indexOf('Farmers');
        expect(remapWordIndex(oldText, newText, oldIndex)).toBe(newText.split(/\s+/).indexOf('Farmers'));
    });

    it('falls back to a proportional spot when the words themselves were cut', async () => {
        const { remapWordIndex } = await import('./readerNav');
        const oldText = 'a b c d e f g h i j';
        const newText = 'k l m n o';
        expect(remapWordIndex(oldText, newText, 8)).toBe(4);
        expect(remapWordIndex(oldText, '', 3)).toBe(0);
        expect(remapWordIndex(oldText, oldText, 3)).toBe(3);
    });
});
