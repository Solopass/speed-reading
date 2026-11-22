import { describe, expect, it } from 'vitest';
import { hasGutenbergMarkers, isPublisherMatter, labelForEpubType, stripGutenberg, stripGutenbergChapters } from './bookBoilerplate';

const HEADER = `The Project Gutenberg eBook of Walden, by Henry David Thoreau

This eBook is for the use of anyone anywhere in the United States and
most other parts of the world at no cost and with almost no restrictions
whatsoever.

Title: Walden

*** START OF THE PROJECT GUTENBERG EBOOK WALDEN ***

Produced by Judith Boss, and David Widger

`;
const BODY = `WALDEN

Economy

When I wrote the following pages, or rather the bulk of them, I lived alone, in the woods.`;
const FOOTER = `

*** END OF THE PROJECT GUTENBERG EBOOK WALDEN ***

Updated editions will replace the previous one—the old editions will
be renamed.

START: FULL LICENSE`;

describe('stripGutenberg', () => {
    it('removes the header, credits and license around the book', () => {
        const { text, removed } = stripGutenberg(HEADER + BODY + FOOTER);
        expect(removed).toBe(true);
        expect(text).toBe(BODY);
    });

    it('handles Windows line endings and the older "THIS" wording', () => {
        const raw = (HEADER + BODY + FOOTER).replace('THE PROJECT GUTENBERG EBOOK WALDEN', 'THIS PROJECT GUTENBERG EBOOK WALDEN').replace(/\n/g, '\r\n');
        const { text, removed } = stripGutenberg(raw);
        expect(removed).toBe(true);
        expect(text.replace(/\r/g, '')).toBe(BODY);
    });

    it('handles pre-2000 texts that end the small print instead', () => {
        const raw = `Some legal text\n*END*THE SMALL PRINT! FOR PUBLIC DOMAIN ETEXTS*Ver.04.29.93*END*\n\n${BODY}\n\nEnd of The Project Gutenberg Etext of Walden\n`;
        const { text, removed } = stripGutenberg(raw);
        expect(removed).toBe(true);
        expect(text).toBe(BODY);
    });

    it('leaves other text alone, even text that mentions Project Gutenberg', () => {
        const raw = 'I found this on Project Gutenberg.\n\nEnd of the Project Gutenberg EBook of nothing, said early on.\n\n' + 'More words. '.repeat(50);
        expect(stripGutenberg(raw)).toEqual({ text: raw, removed: false });
        expect(hasGutenbergMarkers(raw)).toBe(false);
        expect(hasGutenbergMarkers(HEADER)).toBe(true);
    });
});

describe('stripGutenbergChapters', () => {
    it('drops header files before the START marker and license files after END', () => {
        const chapters = [
            { heading: 'Cover', text: 'The Project Gutenberg eBook of Walden' },
            { heading: 'Header', text: `Title: Walden\n\n*** START OF THE PROJECT GUTENBERG EBOOK WALDEN ***\n\nProduced by someone\n\nEconomy\n\nWhen I wrote…` },
            { heading: 'Where I Lived', text: 'I went to the woods.' },
            { heading: 'Conclusion', text: 'The sun is but a morning star.\n\n*** END OF THE PROJECT GUTENBERG EBOOK WALDEN ***\n\nLicense text' },
            { heading: 'License', text: 'Section 1. General Terms of Use' }
        ];
        const { chapters: out, removed } = stripGutenbergChapters(chapters);
        expect(removed).toBe(true);
        expect(out.map(c => c.heading)).toEqual(['Header', 'Where I Lived', 'Conclusion']);
        expect(out[0].text).toBe('Economy\n\nWhen I wrote…');
        expect(out[2].text).toBe('The sun is but a morning star.');
    });

    it('returns chapters unchanged without markers', () => {
        const chapters = [{ text: 'One' }, { text: 'Two' }];
        expect(stripGutenbergChapters(chapters)).toEqual({ chapters, removed: false });
    });
});

describe('isPublisherMatter', () => {
    it('knows title pages, imprints, colophons and copyright pages', () => {
        expect(isPublisherMatter('titlepage')).toBe(true);
        expect(isPublisherMatter('frontmatter imprint')).toBe(true);
        expect(isPublisherMatter('colophon')).toBe(true);
        expect(isPublisherMatter('copyright-page')).toBe(true);
    });

    it('keeps the book itself, dedications, prefaces and notes', () => {
        for (const t of ['chapter', 'bodymatter z3998:fiction', 'dedication', 'epigraph', 'preface', 'endnotes', 'frontmatter', '', null]) {
            expect(isPublisherMatter(t)).toBe(false);
        }
    });
});

describe('labelForEpubType', () => {
    it('names untitled front and back matter', () => {
        expect(labelForEpubType('dedication')).toBe('Dedication');
        expect(labelForEpubType('frontmatter preface')).toBe('Preface');
        expect(labelForEpubType('chapter')).toBeNull();
        expect(labelForEpubType(undefined)).toBeNull();
    });
});

describe('Gutenberg edge cases', () => {
    it('keeps later volumes of an omnibus that end with the old closing line', () => {
        const vol = (n) => `Volume ${n}\n\n${'Story words go here. '.repeat(40)}`;
        const raw = `Header\n*** START OF THE PROJECT GUTENBERG EBOOK OMNIBUS ***\n\n${vol(1)}\n\nEnd of Project Gutenberg's Etext of Volume I\n\n${vol(2)}\n\n${vol(3)}\n\n*** END OF THE PROJECT GUTENBERG EBOOK OMNIBUS ***\nLicense`;
        const { text } = stripGutenberg(raw);
        expect(text).toContain('Volume 3');
        expect(text).not.toContain('License');
    });

    it('does not crash when END comes before START in one file', () => {
        const chapters = [{ text: '*** END OF THE PROJECT GUTENBERG EBOOK X ***\n\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\n\nThe book.' }];
        expect(stripGutenbergChapters(chapters).chapters.map(c => c.text)).toEqual(['The book.']);
    });
});
