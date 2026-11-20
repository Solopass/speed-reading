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

describe('reflowParagraphs (PDF wrapped lines)', () => {
    it('joins full-width wrapped lines into one paragraph', async () => {
        const { reflowParagraphs } = await import('./importText');
        const text = 'The river carried silt down from the hills every spring\nand the farmers waited for the floods to pass before\nplanting again.';
        expect(reflowParagraphs(text)).toBe('The river carried silt down from the hills every spring and the farmers waited for the floods to pass before planting again.');
    });

    it('splits at a short line that ends a sentence and keeps headings apart', async () => {
        const { reflowParagraphs } = await import('./importText');
        const text = 'Chapter Two\nThe river carried silt down from the hills every spring\nand the farmers waited.\nIn the autumn the water fell again and the fields dried\nout under a pale sun.';
        expect(reflowParagraphs(text).split('\n\n')).toEqual([
            'Chapter Two',
            'The river carried silt down from the hills every spring and the farmers waited.',
            'In the autumn the water fell again and the fields dried out under a pale sun.'
        ]);
    });

    it('leaves lists and verse (all short lines) alone', async () => {
        const { reflowParagraphs } = await import('./importText');
        expect(reflowParagraphs('Eggs\nFlour\nMilk')).toBe('Eggs\nFlour\nMilk');
    });
});

describe('page numbers inside a paragraph', () => {
    it('removing one does not split the paragraph', () => {
        const text = normalizeText('A sentence that wraps\n42\nonto the next line.', { stripPageNumbers: true });
        expect(text.split(/\n\s*\n/)).toHaveLength(1);
    });
});

describe('chaptersFromAnchors', () => {
    const chapters = [
        { title: 'One', text: 'Opening line of one.\n\nBody of chapter one here.' },
        { title: 'Two', text: 'Chapter Two\n\nIt began , as ever , in the rain.\n\nMore of two.' },
        { title: 'Three', text: 'Chapter Three\n\nThe end came quickly.' }
    ];

    it('keeps cleaning and cuts when re-splitting into the file chapters', async () => {
        const { chaptersFromAnchors } = await import('./importText');
        // Cleaned text: punctuation tidied, one paragraph of chapter one cut.
        const cleaned = 'Opening line of one.\n\nChapter Two\n\nIt began, as ever, in the rain.\n\nMore of two.\n\nChapter Three\n\nThe end came quickly.';
        const out = chaptersFromAnchors(cleaned, chapters);
        expect(out.map(c => c.title)).toEqual(['One', 'Two', 'Three']);
        expect(out[0].text).toBe('Opening line of one.');
        expect(out[1].text).toContain('It began, as ever, in the rain.');
    });

    it('finds a chapter by a later paragraph when its heading was cut', async () => {
        const { chaptersFromAnchors } = await import('./importText');
        const cleaned = 'Opening line of one.\n\nBody of chapter one here.\n\nIt began, as ever, in the rain.\n\nMore of two.\n\nChapter Three\n\nThe end came quickly.';
        const out = chaptersFromAnchors(cleaned, chapters);
        expect(out[1]).toEqual({ title: 'Two', text: 'It began, as ever, in the rain.\n\nMore of two.' });
    });
});

describe('validateAiCuts', () => {
    const prose = 'The committee met on Tuesday to discuss the budget for the coming year. Several members raised concerns about the cost of the new library building and asked for a fuller breakdown of the figures before any vote was taken. The chair agreed to circulate it within a week.';
    const text = ['Home | About | Contact', prose, 'Chapter 4', 'Copyright 2024 Example Press. All rights reserved. No part of this book may be reproduced in any form without written permission from the publisher, except for brief quotations used in reviews and certain other noncommercial uses permitted by law.'].join('\n\n');
    const blocks = [0, 1, 2, 3].map(index => ({ index, text: '' }));

    it('accepts clutter and refuses prose and headings', async () => {
        const { validateAiCuts } = await import('./importText');
        const { accepted, skipped } = validateAiCuts([
            { index: 0, reason: 'nav' }, { index: 1, reason: 'x' }, { index: 2, reason: 'x' }, { index: '3', reason: 'legal' }
        ], blocks, text);
        expect(accepted.map(c => c.index)).toEqual([0, 3]);
        expect(skipped.map(s => s.why)).toEqual(['ordinary prose', 'a chapter heading']);
    });

    it('refuses an index the AI was not shown', async () => {
        const { validateAiCuts } = await import('./importText');
        const { accepted, skipped } = validateAiCuts([{ index: 0, reason: 'nav' }], [{ index: 3, text: '' }], text);
        expect(accepted).toEqual([]);
        expect(skipped[0].why).toMatch(/not one/);
    });
});

describe('restoring cuts', () => {
    it('puts each cut back in its original place, in any order, after other cuts', async () => {
        const { applyParagraphCuts, restoreCutItem } = await import('./importText');
        const doc = ['p0', 'p1 nav', 'p2', 'p3', 'p4 legal', 'p5'].join('\n\n');
        const first = applyParagraphCuts(doc, [{ index: 1, reason: 'nav' }]);
        // A second round on the already-cut text (indices have shifted).
        const second = applyParagraphCuts(first.text, [{ index: 3, reason: 'legal' }]);
        expect(second.text).toBe(['p0', 'p2', 'p3', 'p5'].join('\n\n'));
        let t = restoreCutItem(second.text, first.cutItems[0]);
        t = restoreCutItem(t, second.cutItems[0]);
        expect(t).toBe(doc);
    });
});

describe('review regressions', () => {
    it('a contents page listing the headings does not capture the chapters', async () => {
        const { chaptersFromAnchors } = await import('./importText');
        const chapters = [
            { title: 'Contents', text: 'Contents\n\nChapter 1\n\nChapter 2' },
            { title: 'Chapter 1', text: 'Chapter 1\n\nIt was a dark night and the rain came down hard.' },
            { title: 'Chapter 2', text: 'Chapter 2\n\nMorning brought a pale sun over the hills.' }
        ];
        const text = chapters.map(c => c.text).join('\n\n');
        const out = chaptersFromAnchors(text, chapters);
        expect(out.map(c => c.text)).toEqual(chapters.map(c => c.text));
    });

    it('long clutter starting with a heading word can still be cut', async () => {
        const { validateAiCuts } = await import('./importText');
        const toc = 'Chapter 1 The Boy 3 Chapter 2 The Storm 17 Chapter 3 The Sea 31 Chapter 4 Home 52';
        const { accepted } = validateAiCuts([{ index: 0, reason: 'toc' }], [{ index: 0, text: '' }], toc);
        expect(accepted).toHaveLength(1);
    });

    it('reflow keeps a list after a colon one item per line', async () => {
        const { reflowParagraphs } = await import('./importText');
        const text = 'You will need the following things for this recipe today:\nflour\nsugar\neggs';
        expect(reflowParagraphs(text)).toBe(text);
    });

    it('a null or empty AI index is not block 0', async () => {
        const { validateAiCuts, aiCutIndex } = await import('./importText');
        expect(Number.isNaN(aiCutIndex({ index: null }))).toBe(true);
        expect(Number.isNaN(aiCutIndex({ index: '' }))).toBe(true);
        expect(aiCutIndex({ index: '2' })).toBe(2);
        expect(validateAiCuts([{ index: null }], [{ index: 0, text: '' }], 'Home | About').accepted).toEqual([]);
    });

    it('a removed page number is restored next to its paragraph, not at the end', async () => {
        const { normalizeTextWithStats, restoreCutItem } = await import('./importText');
        const raw = 'First para line one.\nthe end.\n12\n\nSecond para.\n\nThird para.\n\nFourth para.';
        const { text, cuts } = normalizeTextWithStats(raw, { stripPageNumbers: true });
        const restored = restoreCutItem(text, cuts[0]).split('\n\n');
        expect(restored.indexOf('12')).toBe(1);
    });
});

describe('hyphens at line ends', () => {
    const rank = new Map(['well', 'known', 'example', 'exam', 'ple', 'state', 'art'].map((w, i) => [w, i]));

    it('joins a word the typesetter split', () => {
        expect(normalizeText('A worked exam-\nple here.', { rank })).toBe('A worked example here.');
    });

    it('keeps the hyphen in a compound whose halves are words but whose join is not', () => {
        expect(normalizeText('A well-\nknown fact.', { rank })).toBe('A well-known fact.');
    });

    it('follows the spelling the document uses elsewhere', () => {
        expect(normalizeText('The state-of-the-art lab. Truly state-of-the-\nart.', {})).toContain('state-of-the-art.');
        expect(normalizeText('Use the sub-\nmarine. A submarine dived.', {})).toContain('submarine.');
    });

    it('without a word list it still joins, as before', () => {
        expect(normalizeText('A well-\nknown fact.')).toBe('A wellknown fact.');
    });
});

describe('footnotes and reference lists', () => {
    const rank = new Map(['history', 'war', 'the', 'of'].map((w, i) => [w, i]));
    const prose = (n) => `Paragraph ${n} talks about the long history of the river and the farms along it, in plain sentences. It goes on for a while.`;

    it('strips glued footnote numbers but not page refs, times or real tokens', async () => {
        const { stripNoteMarkers } = await import('./importText');
        expect(stripNoteMarkers('The war ended.12 Then peace.', rank).text).toBe('The war ended. Then peace.');
        expect(stripNoteMarkers('A history12 of it.', rank).text).toBe('A history of it.');
        expect(stripNoteMarkers('See No.5 and p.12 at 3:45 with covid19.', rank).text).toBe('See No.5 and p.12 at 3:45 with covid19.');
    });

    it('finds footnote paragraphs and a trailing reference list', async () => {
        const { findNotes } = await import('./importText');
        const text = [prose(1), '12 See Smith (1999), p. 45.', prose(2), prose(3), prose(4),
            'References', 'Smith, J. (1999). Rivers. Press.', 'Jones, K. et al. (2004). Farms.', 'Lee, M. (2011). Floods, pp. 3-9.'].join('\n\n');
        const found = findNotes(text, rank);
        expect(found.blocks).toEqual([1]);
        expect(found.references).toEqual({ heading: 5, end: 9 });
    });

    it('does not treat a numbered list or a Notes heading over prose as notes', async () => {
        const { findNotes } = await import('./importText');
        const text = [prose(1), '1 Preheat the oven', '2 Mix the flour', prose(2), 'Notes', prose(3), prose(4), prose(5)].join('\n\n');
        const found = findNotes(text, rank);
        expect(found.blocks).toEqual([]);
        expect(found.references).toBeNull();
    });

    it('removeNotes cuts restorably and strips markers', async () => {
        const { findNotes, removeNotes, restoreCutItem } = await import('./importText');
        const text = [`${prose(1)}.3`, '3 Ibid., p. 7.', prose(2), prose(3), 'Bibliography', 'Smith (1999).', 'Jones (2004).', 'Lee (2011).'].join('\n\n');
        const found = findNotes(text, rank);
        const out = removeNotes(text, found, rank);
        expect(out.text.split('\n\n')).toHaveLength(3);
        expect(out.cutItems.map(c => c.reason)).toEqual(['Footnote', 'Reference list', 'Reference list', 'Reference list', 'Reference list']);
        expect(restoreCutItem(out.text, out.cutItems[0]).split('\n\n')[1]).toBe('3 Ibid., p. 7.');
    });
});

describe('AI repair', () => {
    const text = [
        'The river carried silt down from the hills every spring and the',
        'farmers waited for the floods to pass.',
        'Th e w ord s here were broken up by the scanner badly.',
        'A clean paragraph that needs nothing at all.'
    ].join('\n\n');

    it('picks paragraphs split mid-sentence and garbled ones, not clean ones', async () => {
        const { selectBlocksForRepair } = await import('./importText');
        const picked = selectBlocksForRepair(text);
        expect(picked.map(b => b.index)).toEqual([0, 2]);
        expect(picked[0].next).toMatch(/^farmers/);
    });

    it('applies a merge and a light fix, refuses a rewrite, and undoes each', async () => {
        const { selectBlocksForRepair, applyRepairs, undoRepair } = await import('./importText');
        const shown = selectBlocksForRepair(text);
        const { text: fixed, changes, skipped } = applyRepairs(text, [
            { index: 0, mergeWithNext: true, text: 'The river carried silt down from the hills every spring and the farmers waited for the floods to pass.' },
            { index: 2, text: 'The words here were broken up by the scanner badly.' },
            { index: 3, text: 'Something entirely different.' }
        ], shown);
        expect(fixed.split('\n\n')).toEqual([
            'The river carried silt down from the hills every spring and the farmers waited for the floods to pass.',
            'The words here were broken up by the scanner badly.',
            'A clean paragraph that needs nothing at all.'
        ]);
        expect(changes).toHaveLength(2);
        expect(skipped.map(s => s.index)).toEqual([3]);
        let back = undoRepair(fixed, changes[1]);
        back = undoRepair(back, changes[0]);
        expect(back).toBe(text);
    });

    it('refuses a fix that changes the wording', async () => {
        const { selectBlocksForRepair, applyRepairs } = await import('./importText');
        const { changes, skipped } = applyRepairs(text, [
            { index: 2, text: 'These words were mangled by a scanning device, sadly.' }
        ], selectBlocksForRepair(text));
        expect(changes).toEqual([]);
        expect(skipped[0].why).toMatch(/wording/);
    });
});

describe('notes review regressions', () => {
    const rank = new Map(['history', 'war', 'the', 'of'].map((w, i) => [w, i]));

    it('leaves scripture references and abbreviated dates alone', async () => {
        const { stripNoteMarkers } = await import('./importText');
        const s = 'See Gen.3:16 and Matt.5:3, from Jan.12 to Ex.4 in Nos.5 today.';
        expect(stripNoteMarkers(s, rank).text).toBe(s);
        expect(stripNoteMarkers('The war ended.12 Then peace.', rank).text).toBe('The war ended. Then peace.');
    });

    it('does not take numbered list items with years for footnotes', async () => {
        const { findNotes } = await import('./importText');
        const prose = 'A long ordinary paragraph about the river and the farms along it, written in plain sentences. It goes on.';
        const text = [prose, '1. In 1912, the bridge opened.', '2. In 1914, war broke out.', prose, '7 In 1990, it changed.', prose].join('\n\n');
        expect(findNotes(text, rank).blocks).toEqual([]);
    });
});
