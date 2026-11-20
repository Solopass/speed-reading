import { describe, expect, it } from 'vitest';
import {
    chaptersFromHeadings, decodeTextBytes, joinPdfPages, normalizeText, stripMarkdown, stripRepeatedHeadersFooters
} from './importText';
import { buildChapters } from './book';

describe('PDF header/footer stripping keeps page structure', () => {
    const page = (n) => `Running Header\nFirst line of a paragraph that wraps\nonto a second line.\n\nA new paragraph here.\n${n}`;

    it('removes the repeated lines but not the line and paragraph breaks', () => {
        const pages = [1, 2, 3, 4].map(page);
        const out = stripRepeatedHeadersFooters(pages);
        expect(out[0]).toBe('First line of a paragraph that wraps\nonto a second line.\n\nA new paragraph here.');
        // Wrapped lines stay one paragraph, so they cannot be mistaken for headings.
        expect(out[0].split(/\n\s*\n/)).toHaveLength(2);
    });

    it('a wrapped line starting with "part" is not split into a fake chapter', () => {
        const body = Array.from({ length: 40 }, () => 'The river carried silt down from the hills every spring and the farmers waited').join(' ');
        const pages = [1, 2, 3, 4, 5].map(n => `Book Title\n${body}\npart of the plan was to wait for the floods\n${body}.\n${n}`);
        const text = normalizeText(joinPdfPages(stripRepeatedHeadersFooters(pages)), { stripPageNumbers: true });
        expect(buildChapters({ text }).some(c => /^part of/i.test(c.title))).toBe(false);
    });
});

describe('joinPdfPages', () => {
    it('joins a sentence that runs over a page break', () => {
        expect(joinPdfPages(['The flood came in the', 'spring of that year.'])).toBe('The flood came in the spring of that year.');
    });

    it('rejoins a word hyphenated across a page break', () => {
        expect(normalizeText(joinPdfPages(['A worked exam-', 'ple of it.']))).toBe('A worked example of it.');
    });

    it('keeps a paragraph break when the page ends a sentence', () => {
        expect(joinPdfPages(['It ended.', 'Next part.'])).toBe('It ended.\n\nNext part.');
        expect(joinPdfPages(['No full stop here', 'But a capital next'])).toBe('No full stop here\n\nBut a capital next');
    });
});

describe('page numbers outside PDFs', () => {
    it('keeps standalone numbers (chapter headings) unless asked to strip them', () => {
        const text = 'Intro line\n\n1\n\nFirst chapter text.\n\n2\n\nSecond chapter text.';
        expect(normalizeText(text)).toContain('\n\n1\n\n');
        expect(normalizeText(text, { stripPageNumbers: true })).not.toMatch(/^1$/m);
    });
});

describe('stripMarkdown', () => {
    it('leaves underscores and asterisks inside words alone', () => {
        expect(stripMarkdown('call my_var_name now')).toBe('call my_var_name now');
        expect(stripMarkdown('2*3*4 = 24')).toBe('2*3*4 = 24');
    });

    it('still strips real emphasis', () => {
        expect(stripMarkdown('a **bold** and _soft_ word')).toBe('a bold and soft word');
    });

    it('removes bullets, inline HTML and reference links', () => {
        expect(stripMarkdown('- one\n* two\n+ three')).toBe('one\ntwo\nthree');
        expect(stripMarkdown('a <span class="x">b</span> c')).toBe('a b c');
        expect(stripMarkdown('see [the docs][1]\n\n[1]: https://example.com').trim()).toBe('see the docs');
    });
});

describe('chaptersFromHeadings', () => {
    it('splits on the top heading level that occurs twice', () => {
        const ch = chaptersFromHeadings([
            { text: 'Preface words', level: 0 },
            { text: 'One', level: 1 }, { text: 'Body one.', level: 0 },
            { text: 'Sub', level: 2 }, { text: 'More one.', level: 0 },
            { text: 'Two', level: 1 }, { text: 'Body two.', level: 0 }
        ]);
        expect(ch.map(c => c.title)).toEqual(['Opening', 'One', 'Two']);
        expect(ch[1].text).toBe('One\n\nBody one.\n\nSub\n\nMore one.');
    });

    it('returns null without at least two headings', () => {
        expect(chaptersFromHeadings([{ text: 'One', level: 1 }, { text: 'x', level: 0 }])).toBeNull();
    });
});

describe('extraction spacing', () => {
    it('reattaches punctuation and brackets left as separate words', () => {
        expect(normalizeText('word , and ( this ) too .')).toBe('word, and (this) too.');
        expect(normalizeText('Wow ! Really ?')).toBe('Wow! Really?');
    });

    it('turns spaced dots and spaced hyphens between words into an ellipsis and a dash', () => {
        expect(normalizeText('wait . . . what')).toBe('wait… what');
        expect(normalizeText('He came -- then left')).toBe('He came — then left');
        expect(normalizeText('He came - then left')).toBe('He came — then left');
    });

    it('leaves hyphenated words, number ranges and list dashes alone', () => {
        expect(normalizeText('a well-known fact')).toBe('a well-known fact');
        expect(normalizeText('pages 10 - 20')).toBe('pages 10 - 20');
        expect(normalizeText('- item one')).toBe('- item one');
    });

    it('leaves code, formulas and single-letter ranges alone', () => {
        expect(normalizeText('Run git add . now')).toBe('Run git add . now');
        expect(normalizeText('a ? b : c')).toBe('a ? b : c');
        expect(normalizeText('x - y and pages i - iv')).toBe('x - y and pages i - iv');
        expect(normalizeText('(a+b)² here')).toBe('(a+b)2 here');
    });

    it('drops superscript footnote markers after punctuation', () => {
        expect(normalizeText('The end.¹ Next one')).toBe('The end. Next one');
        expect(normalizeText('area in m²')).toBe('area in m2');
    });
});

describe('decodeTextBytes', () => {
    it('reads UTF-8, Windows-1252 and UTF-16', () => {
        expect(decodeTextBytes(new TextEncoder().encode('café'))).toBe('café');
        expect(decodeTextBytes(new Uint8Array([0x63, 0x61, 0x66, 0xE9]))).toBe('café');
        expect(decodeTextBytes(new Uint8Array([0xFF, 0xFE, 0x68, 0x00, 0x69, 0x00]))).toBe('hi');
    });
});
