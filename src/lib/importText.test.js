import { describe, expect, it } from 'vitest';
import {
    SUPPORTED_EXTENSIONS, applyParagraphCuts, extensionOf, isSupported, normalizeText, normalizeTextWithStats,
    orderPdfItems, restoreCutItem, selectBlocksForAiClean, stripMarkdown, stripRepeatedHeadersFooters, titleFromFilename
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

    it('strips invisible, control, replacement, and Private Use Area characters', () => {
        expect(normalizeText('com\u00ADpre\u200Bhen\uFEFFsion \uFFFD\uE001 test\u0007')).toBe('comprehension test');
    });

    it('rejoins hyphenated line breaks without collapsing paragraph breaks', () => {
        expect(normalizeText('speed-\nreading\n\nNext paragraph.')).toBe('speedreading\n\nNext paragraph.');
    });

    it('removes dot leaders, divider lines, standalone page numbers, and stray symbols', () => {
        const dirty = 'Chapter 1 ........ 12\n---\n• First point | ok\nPage 12\n42\n***\nSecond point.';
        expect(normalizeText(dirty)).toBe('Chapter 1 12\n\nFirst point ok\n\nSecond point.');
    });
});

describe('stripRepeatedHeadersFooters', () => {
    it('removes repeated headers and footers across PDF pages while keeping unique lines', () => {
        const pages = [
            'The Great Book\nBody paragraph one.\nFooter 1',
            'The Great Book\nBody paragraph two.\nFooter 2',
            'The Great Book\nBody paragraph three.\nFooter 3',
            'The Great Book\nBody paragraph four.\nFooter 4'
        ];
        expect(stripRepeatedHeadersFooters(pages)).toEqual([
            'Body paragraph one.',
            'Body paragraph two.',
            'Body paragraph three.',
            'Body paragraph four.'
        ]);
    });

    it('leaves short 1-2 page documents untouched', () => {
        const pages = ['Title\nPage one.', 'Title\nPage two.'];
        expect(stripRepeatedHeadersFooters(pages)).toEqual(pages);
    });
});

describe('stripMarkdown and optional filters', () => {
    it('strips frontmatter, links, images, emphasis, and headings while keeping text', () => {
        const md = '---\ntitle: Demo\n---\n# Heading\n\nRead **this** [article](https://example.com) ![img](pic.png) with `code`.';
        expect(normalizeText(stripMarkdown(md))).toBe('Heading\n\nRead this article with code.');
    });

    it('strips URLs and numeric citations when requested', () => {
        const raw = 'See https://example.com/paper for details [1, 2] and more [14].';
        expect(normalizeText(raw, { stripUrls: true, stripCitations: true })).toBe('See for details and more.');
        expect(normalizeText(raw)).toBe(raw);
    });

    it('reports cleaning stats via normalizeTextWithStats', () => {
        const raw = 'speed-\nreading\u00AD\nPage 1\nChapter 1 ........ 5';
        const { text, stats, cuts } = normalizeTextWithStats(raw);
        expect(text).toBe('speedreading\n\nChapter 1 5');
        expect(stats.rejoinedHyphens).toBe(1);
        expect(stats.junkChars).toBe(1);
        expect(stats.pageNumbers).toBe(1);
        expect(stats.dotLeaders).toBe(1);
        expect(cuts).toHaveLength(1);
        expect(cuts[0].reason).toBe('Page number');
    });

    it('selects blocks, applies AI cuts, and restores cut blocks cleanly', () => {
        const doc = 'Cookie policy\n\nReal paragraph one.\n\nAll rights reserved.';
        const blocks = selectBlocksForAiClean(doc);
        expect(blocks).toHaveLength(3);

        const { text, cutItems } = applyParagraphCuts(doc, [
            { index: 0, reason: 'Cookie banner' },
            { index: 2, reason: 'Legal boilerplate' }
        ]);
        expect(text).toBe('Real paragraph one.');
        expect(cutItems).toHaveLength(2);

        const restored = restoreCutItem(text, cutItems[0]);
        expect(restored).toBe('Cookie policy\n\nReal paragraph one.');
    });
});

describe('orderPdfItems', () => {
    it('reads left column top-to-bottom before right column in 2-column PDFs', () => {
        const item = (str, x, y) => ({ str, width: 40, transform: [1, 0, 0, 1, x, y] });
        const interleaved = [
            item('L1', 40, 700), item('R1', 340, 700),
            item('L2', 40, 680), item('R2', 340, 680),
            item('L3', 40, 660), item('R3', 340, 660),
            item('L4', 40, 640), item('R4', 340, 640),
            item('L5', 40, 620), item('R5', 340, 620),
            item('L6', 40, 600), item('R6', 340, 600)
        ];
        expect(orderPdfItems(interleaved, 600).map(i => i.str)).toEqual([
            'L1', 'L2', 'L3', 'L4', 'L5', 'L6',
            'R1', 'R2', 'R3', 'R4', 'R5', 'R6'
        ]);
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
