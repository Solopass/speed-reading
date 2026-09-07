import { describe, expect, it } from 'vitest';
import {
    SUPPORTED_EXTENSIONS, extensionOf, isSupported, normalizeText, titleFromFilename
} from './importText';

const NBSP = String.fromCharCode(160);

describe('extensionOf', () => {
    it('lowercases and handles multi-dot names', () => {
        expect(extensionOf('Book.EPUB')).toBe('.epub');
        expect(extensionOf('my.notes.v2.md')).toBe('.md');
        expect(extensionOf('README')).toBe('');
        expect(extensionOf('')).toBe('');
    });
});

describe('isSupported', () => {
    it('accepts every advertised format', () => {
        SUPPORTED_EXTENSIONS.forEach(ext => expect(isSupported(`file${ext}`)).toBe(true));
    });

    it('rejects formats with no text to extract', () => {
        ['a.png', 'a.mp3', 'a.zip', 'a.doc', 'a'].forEach(name => expect(isSupported(name)).toBe(false));
    });
});

describe('titleFromFilename', () => {
    it('strips the extension and tidies separators', () => {
        expect(titleFromFilename('the-great-gatsby.epub')).toBe('the great gatsby');
        expect(titleFromFilename('my_notes.txt')).toBe('my notes');
    });

    it('falls back rather than returning an empty title', () => {
        expect(titleFromFilename('.txt')).toBe('Imported text');
        expect(titleFromFilename('')).toBe('Imported text');
    });
});

describe('normalizeText', () => {
    it('keeps paragraph breaks, which the reader and pacer depend on', () => {
        expect(normalizeText('One.\n\nTwo.')).toBe('One.\n\nTwo.');
    });

    it('collapses runs of blank lines to a single break', () => {
        expect(normalizeText('One.\n\n\n\n\nTwo.')).toBe('One.\n\nTwo.');
    });

    it('collapses intra-line whitespace and trims each line', () => {
        expect(normalizeText('  one    two\t\tthree  ')).toBe('one two three');
    });

    it('normalizes Windows and old Mac line endings', () => {
        expect(normalizeText('One.\r\n\r\nTwo.')).toBe('One.\n\nTwo.');
        expect(normalizeText('One.\r\rTwo.')).toBe('One.\n\nTwo.');
    });

    // EPUB and PDF text is full of non-breaking spaces, which would otherwise
    // survive as characters that never break a line.
    it('turns non-breaking spaces into ordinary ones', () => {
        expect(normalizeText(`one${NBSP}two`)).toBe('one two');
    });

    // PDF extraction commonly yields typographic ligatures.
    it('decomposes ligatures that PDF extraction produces', () => {
        expect(normalizeText('the ﬁrst ﬂight')).toBe('the first flight');
    });
});

// extractFromHtml needs DOMParser, so it is covered by the browser checks
// alongside the EPUB, DOCX and PDF readers, which need real files.
describe('extractFromHtml', () => {
    it.skipIf(typeof DOMParser === 'undefined')('splits block elements into paragraphs', async () => {
        const { extractFromHtml } = await import('./importText');
        const result = extractFromHtml('<html><head><title>T</title></head><body><p>One.</p><p>Two.</p></body></html>');
        expect(result.title).toBe('T');
        expect(result.text).toBe('One.\n\nTwo.');
    });
});
