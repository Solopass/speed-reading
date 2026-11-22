// Publisher matter that isn't part of a book: Project Gutenberg's header and
// license around every text it hosts, and the title page, imprint, colophon
// and copyright pages EPUBs (Standard Ebooks' among them) carry as their own
// files. Imported as-is, these became the first and last "chapters".

/** Gutenberg's markers sit on lines of their own: "*** START OF THE PROJECT GUTENBERG EBOOK WALDEN ***". */
const GUTENBERG_START_RE = /^[ \t]*\*{3}[ \t]*START OF (?:THE |THIS )?PROJECT GUTENBERG E-?BOOK\b[^\n]*$/im;
const GUTENBERG_END_RE = /^[ \t]*\*{3}[ \t]*END OF (?:THE |THIS )?PROJECT GUTENBERG E-?BOOK\b[^\n]*$/im;
/** Texts from before 2000 or so end the license with this line instead of a START marker. */
const OLD_SMALL_PRINT_END_RE = /^[^\n]*\*END\*[ \t]*THE SMALL PRINT![^\n]*$/im;
/** Older texts close with "End of the Project Gutenberg EBook of …" before (or instead of) the END marker. */
const OLD_END_LINE_RE = /^[ \t]*End of (?:the )?Project Gutenberg(?:'s|’s)? (?:E-?book|E-?text|Etext)\b[^\n]*$/im;
/** Credit lines right after the START marker: "Produced by …", "E-text prepared by …". */
const CREDIT_RE = /^(?:Produced by|E-?text prepared by|This e-?(?:book|text) (?:was|is) (?:produced|prepared) by|Transcribed from)\b/i;

/** HTML parts Gutenberg wraps its header and license in (HTML and EPUB editions since 2021). */
export const GUTENBERG_HTML_SELECTOR = '#pg-header, #pg-footer, #pg-machine-header, #pg-start-separator, #pg-end-separator, .pg-boilerplate';

/** True when the text carries Gutenberg's header or license. */
export const hasGutenbergMarkers = (text) => {
    const s = String(text ?? '');
    return GUTENBERG_START_RE.test(s) || GUTENBERG_END_RE.test(s) || OLD_SMALL_PRINT_END_RE.test(s);
};

const lineEnd = (s, index) => {
    const nl = s.indexOf('\n', index);
    return nl === -1 ? s.length : nl + 1;
};

/** Drops credit paragraphs ("Produced by …") from the start of the text. */
function dropLeadingCredits(text) {
    const paras = text.split(/\n[ \t]*\n/);
    let i = 0;
    // Only short paragraphs: a credit is a line or two, never the book.
    const isCredit = (p) => p.trim() === '' || (p.length < 400 && CREDIT_RE.test(p.trim()));
    while (i < Math.min(paras.length, 4) && isCredit(paras[i])) i += 1;
    return paras.slice(i).join('\n\n');
}

/**
 * Removes Project Gutenberg's header (everything up to the START marker) and
 * license (the END marker and everything after it). Text without the markers
 * comes back unchanged. Returns { text, removed }.
 */
export function stripGutenberg(raw) {
    let text = String(raw ?? '').replace(/\r\n?/g, '\n');
    let removed = false;

    const start = text.match(GUTENBERG_START_RE) ?? text.match(OLD_SMALL_PRINT_END_RE);
    if (start) {
        text = dropLeadingCredits(text.slice(lineEnd(text, start.index)));
        removed = true;
    }

    const end = text.match(GUTENBERG_END_RE);
    if (end) {
        text = text.slice(0, end.index);
        removed = true;
    }
    // The older closing line: only its last occurrence, and only near the end. An omnibus
    // ends each inner volume with one ("End of Project Gutenberg's Etext of Volume I").
    const oldEnd = [...text.matchAll(new RegExp(OLD_END_LINE_RE.source, 'gim'))].at(-1);
    if (oldEnd && (oldEnd.index > text.length * 0.8 || text.length - oldEnd.index < 500)) {
        text = text.slice(0, oldEnd.index);
        removed = true;
    }

    return { text: removed ? text.trim() : String(raw ?? ''), removed };
}

/**
 * The same for a book split into files (an EPUB's spine): files before the one
 * with the START marker are header, files after the END marker are license.
 * `chapters` are { text, … }; returns { chapters, removed }.
 */
export function stripGutenbergChapters(chapters) {
    const list = [...(chapters ?? [])].map(ch => ({ ...ch, text: String(ch.text ?? '').replace(/\r\n?/g, '\n') }));
    const startAt = list.findIndex(ch => GUTENBERG_START_RE.test(ch.text) || OLD_SMALL_PRINT_END_RE.test(ch.text));
    const endAt = list.findIndex((ch, i) => i >= Math.max(0, startAt) && (GUTENBERG_END_RE.test(ch.text)));
    if (startAt === -1 && endAt === -1) return { chapters: list, removed: false };

    const from = Math.max(0, startAt);
    const to = endAt === -1 ? list.length - 1 : endAt;
    const kept = list.slice(from, to + 1).map((ch, i, arr) => {
        let text = ch.text;
        if (i === 0 && startAt !== -1) {
            const m = text.match(GUTENBERG_START_RE) ?? text.match(OLD_SMALL_PRINT_END_RE);
            text = dropLeadingCredits(text.slice(lineEnd(text, m.index)));
        }
        if (i === arr.length - 1 && endAt !== -1) {
            // END may sit before START in the same file; then it was already cut away.
            const m = text.match(GUTENBERG_END_RE);
            if (m) text = text.slice(0, m.index);
        }
        return { ...ch, text: text.trim() };
    }).filter(ch => ch.text);
    return { chapters: kept, removed: true };
}

/**
 * EPUB structural types (epub:type) of files that are publisher matter, not
 * the book: title pages, imprint, colophon, copyright, contents and lists of
 * illustrations. Dedications, epigraphs, prefaces and notes are kept.
 */
const PUBLISHER_MATTER = new Set([
    'titlepage', 'halftitlepage', 'imprint', 'imprimatur', 'colophon', 'copyright-page',
    'toc', 'loi', 'lot', 'landmarks', 'seriespage', 'cover'
]);

/** True when an epub:type value ("frontmatter imprint") names publisher matter. */
export const isPublisherMatter = (epubType) =>
    String(epubType ?? '').split(/\s+/).some(t => PUBLISHER_MATTER.has(t.replace(/^z3998:/, '').toLowerCase()));

/** Names for untitled EPUB files, from their structural type (a dedication has no heading). */
const TYPE_LABELS = {
    dedication: 'Dedication', epigraph: 'Epigraph', foreword: 'Foreword', preface: 'Preface',
    introduction: 'Introduction', prologue: 'Prologue', epilogue: 'Epilogue', afterword: 'Afterword',
    conclusion: 'Conclusion', appendix: 'Appendix', glossary: 'Glossary', endnotes: 'Endnotes',
    footnotes: 'Notes', acknowledgments: 'Acknowledgments', bibliography: 'Bibliography', index: 'Index',
    preamble: 'Preamble'
};

/** A chapter name for an epub:type value ("frontmatter dedication" → "Dedication"), or null. */
export function labelForEpubType(epubType) {
    for (const t of String(epubType ?? '').toLowerCase().split(/\s+/)) {
        if (TYPE_LABELS[t]) return TYPE_LABELS[t];
    }
    return null;
}
