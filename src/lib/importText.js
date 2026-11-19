// Turns a dropped or picked file into readable prose.
//
// The heavy parsers (zip for EPUB/DOCX, pdf.js for PDF) are dynamically
// imported so they only reach the browser when someone actually opens that
// format. Loading a PDF engine on first paint to support a format most sessions
// never use would be a poor trade.

export const SUPPORTED_EXTENSIONS = [
    '.txt', '.text', '.md', '.markdown', '.html', '.htm', '.epub', '.docx', '.pdf'
];

export const ACCEPT_ATTRIBUTE = SUPPORTED_EXTENSIONS.join(',');

export const extensionOf = (name = '') => {
    const match = String(name).toLowerCase().match(/\.[a-z0-9]+$/);
    return match ? match[0] : '';
};

export const isSupported = (name) => SUPPORTED_EXTENSIONS.includes(extensionOf(name));

/** Filename without its extension, as a fallback title. */
export const titleFromFilename = (name = '') =>
    String(name).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Imported text';

// Invisible, control, replacement, and Private Use Area characters that render
// as tofu boxes or break word splitting / focal-letter alignment in RSVP.
// eslint-disable-next-line no-control-regex
const JUNK_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B-\u200D\u2060\uFEFF\uFFFD\uE000-\uF8FF]/g;
const ASTRAL_PUA_RE = /[\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu;
const LEADING_BULLET_RE = /^\s*[•▪▫●○■□◆◇❖➤➢➔►◄★☆✓✔✕✖†‡§¶]+\s*/;
const DIVIDER_LINE_RE = /^[\s*\-_=~•·|—–]+$/;
const PAGE_NUMBER_RE = /^(?:page\s*\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?|[-–—]\s*\d{1,4}\s*[-–—]|\d{1,4}\s*\/\s*\d{1,4})$/i;
const STRAY_SYMBOL_TOKEN_RE = /(^|\s)[|~^_\\`*=<>[\]{}•▪▫●○■□◆◇❖➤➢➔►◄★☆✓✔✕✖†‡§¶]+(?=\s|$)/g;

/**
 * Strips common Markdown syntax (frontmatter, links, images, emphasis, code
 * fences, heading hashes, blockquote markers) while preserving paragraph breaks.
 */
export function stripMarkdown(raw) {
    return String(raw)
        .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^```[^\n]*$/gm, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^\s*>\s?/gm, '')
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(\*|_)(.*?)\1/g, '$2');
}

const URL_RE = /https?:\/\/\S+/gi;
const CITATION_RE = /\[\d+(?:[\s,\-–]+\d+)*\]/g;

/**
 * Paragraph structure is what the reader renders and what the pacer measures
 * lines from, so blank lines are preserved while runs of whitespace inside a
 * paragraph are collapsed and extraction artifacts are scrubbed.
 */
export function normalizeText(raw, { stripUrls = false, stripCitations = false } = {}) {
    let scrubbed = String(raw)
        // NFKC folds compatibility characters: non-breaking spaces become ordinary
        // ones, and PDF typographic ligatures (fi, fl) decompose back into letters.
        .normalize('NFKC')
        .replace(JUNK_CHARS_RE, '')
        .replace(ASTRAL_PUA_RE, '')
        .replace(/\r\n?/g, '\n')
        // Rejoin words hyphenated across a single wrapped line (common in PDFs).
        .replace(/([A-Za-z]{2,})-[ \t]*\n[ \t]*([a-z]{2,})/g, '$1$2');

    if (stripUrls) scrubbed = scrubbed.replace(URL_RE, '');
    if (stripCitations) scrubbed = scrubbed.replace(CITATION_RE, '');
    if (stripUrls || stripCitations) scrubbed = scrubbed.replace(/[ \t]+([,.;:!?])/g, '$1');

    const rawLines = scrubbed.split('\n');
    const multiLine = rawLines.length > 2;

    return rawLines
        .map(line => {
            let clean = line
                .replace(LEADING_BULLET_RE, '')
                .replace(/\.{4,}/g, ' ')
                .replace(STRAY_SYMBOL_TOKEN_RE, '$1')
                .replace(/[ \t]+/g, ' ')
                .trim();
            if (!clean || DIVIDER_LINE_RE.test(clean)) return '';
            if (multiLine && (PAGE_NUMBER_RE.test(clean) || /^\d{1,4}$/.test(clean))) return '';
            return clean;
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, dd, dt, figcaption';

/**
 * Pulls prose out of an HTML document. Block elements become paragraphs, so the
 * result keeps the shape the reader needs; textContent alone would run the
 * whole document into a single block.
 */
export function extractFromHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, noscript, nav, header, footer, aside, svg').forEach(el => el.remove());

    const blocks = [...doc.querySelectorAll(BLOCK_SELECTOR)]
        // Skip wrappers whose text is already covered by a nested block.
        .filter(el => !el.querySelector(BLOCK_SELECTOR))
        .map(el => el.textContent.trim())
        .filter(Boolean);

    const text = blocks.length ? blocks.join('\n\n') : (doc.body?.textContent ?? '');
    return {
        title: doc.querySelector('title')?.textContent?.trim() || null,
        // The first heading names the chapter when this is one EPUB spine file.
        heading: doc.querySelector('h1, h2, h3')?.textContent?.replace(/\s+/g, ' ').trim() || null,
        text: normalizeText(text)
    };
}

async function readPlain(file, options) {
    return { title: null, text: normalizeText(await file.text(), options) };
}

async function readMarkdown(file, options) {
    return { title: null, text: normalizeText(stripMarkdown(await file.text()), options) };
}

async function readHtml(file, options) {
    const res = extractFromHtml(await file.text());
    return { ...res, text: normalizeText(res.text, options) };
}

const decode = (bytes) => new TextDecoder('utf-8').decode(bytes);

/**
 * EPUB is a zip: container.xml points at the OPF package, whose spine gives the
 * reading order. Following the spine matters — zip entry order is arbitrary, so
 * reading files as they appear can shuffle the chapters.
 */
async function readEpub(file) {
    const { unzipSync } = await import('fflate');
    const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));

    const container = zip['META-INF/container.xml'];
    if (!container) throw new Error('That EPUB is missing its container.xml — the file may be corrupt.');

    const rootPath = new DOMParser()
        .parseFromString(decode(container), 'application/xml')
        .querySelector('rootfile')?.getAttribute('full-path');
    if (!rootPath || !zip[rootPath]) throw new Error('That EPUB does not point at a readable package file.');

    const opf = new DOMParser().parseFromString(decode(zip[rootPath]), 'application/xml');
    const baseDir = rootPath.includes('/') ? rootPath.slice(0, rootPath.lastIndexOf('/') + 1) : '';

    const hrefById = new Map(
        [...opf.querySelectorAll('manifest > item')].map(item => [item.getAttribute('id'), item.getAttribute('href')])
    );

    const chapters = [...opf.querySelectorAll('spine > itemref')]
        .map(ref => hrefById.get(ref.getAttribute('idref')))
        .filter(Boolean)
        // Zip paths are relative to the OPF, and may contain ../ segments.
        .map(href => new URL(href, `file:///${baseDir}`).pathname.replace(/^\//, ''))
        .map(path => zip[path] ?? zip[decodeURIComponent(path)])
        .filter(Boolean)
        .map(bytes => extractFromHtml(decode(bytes)))
        .filter(ch => ch.text);

    if (!chapters.length) throw new Error('No readable chapters found in that EPUB.');

    return {
        title: opf.querySelector('metadata title')?.textContent?.trim() || null,
        text: normalizeText(chapters.map(ch => ch.text).join('\n\n')),
        // Kept separate as well, so book mode can use the file's own chapters.
        chapters: chapters.map((ch, i) => ({ title: ch.heading || `Chapter ${i + 1}`, text: ch.text }))
    };
}

/** DOCX is also a zip; the prose lives in word/document.xml as <w:t> runs. */
async function readDocx(file) {
    const { unzipSync } = await import('fflate');
    const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));

    const documentXml = zip['word/document.xml'];
    if (!documentXml) throw new Error('That .docx has no document body — the file may be corrupt.');

    const doc = new DOMParser().parseFromString(decode(documentXml), 'application/xml');
    const paragraphs = [...doc.getElementsByTagName('w:p')]
        .map(p => [...p.getElementsByTagName('w:t')].map(t => t.textContent).join(''))
        .map(line => line.trim())
        .filter(Boolean);

    if (!paragraphs.length) throw new Error('That .docx appears to contain no text.');
    return { title: null, text: normalizeText(paragraphs.join('\n\n')) };
}

const headerKey = (line) => line.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Removes running headers and footers that repeat across many PDF pages
 * (including odd/even alternating headers or headers with changing page numbers).
 */
export function stripRepeatedHeadersFooters(pages) {
    if (!Array.isArray(pages) || pages.length < 3) return pages ?? [];

    const splitPages = pages.map(p => String(p).split('\n').map(l => l.trim()).filter(Boolean));
    const counts = new Map();

    for (const lines of splitPages) {
        if (lines.length === 0) continue;
        const seenOnPage = new Set();
        for (const candidate of [lines[0], lines[lines.length - 1]]) {
            if (!candidate || candidate.length > 100) continue;
            const key = headerKey(candidate);
            if (!key || seenOnPage.has(key)) continue;
            seenOnPage.add(key);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }

    const threshold = Math.max(3, Math.ceil(pages.length * 0.35));
    const repeated = new Set([...counts.entries()].filter(([, n]) => n >= threshold).map(([k]) => k));
    if (repeated.size === 0) return pages;

    return splitPages.map(lines => {
        const next = [...lines];
        if (next.length && next[0].length <= 100 && repeated.has(headerKey(next[0]))) next.shift();
        if (next.length && next[next.length - 1].length <= 100 && repeated.has(headerKey(next[next.length - 1]))) next.pop();
        return next.join('\n\n');
    });
}

/**
 * pdf.js gives positioned text items rather than lines, so this rebuilds
 * paragraphs from vertical gaps: a large jump means a new paragraph, a small
 * one a wrapped line.
 */
async function readPdf(file, options = {}) {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        options.onProgress?.({ page: pageNumber, totalPages: pdf.numPages });
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();

        let text = '';
        let lastY = null;
        for (const item of content.items) {
            if (!('str' in item)) continue;
            const y = item.transform[5];
            if (lastY !== null) {
                const gap = Math.abs(lastY - y);
                if (gap > 14) text += '\n\n';
                else if (gap > 2 && !/\s$/.test(text) && !/^[\s,.;:!?)\]]/.test(item.str)) text += ' ';
            }
            text += item.str;
            lastY = y;
        }
        pages.push(text);
        if (pageNumber % 4 === 0) await new Promise(r => setTimeout(r, 0));
    }

    const text = normalizeText(stripRepeatedHeadersFooters(pages).join('\n\n'), options);
    if (!text) throw new Error('No text found in that PDF. Scanned pages need OCR first.');

    return { title: (await pdf.getMetadata().catch(() => null))?.info?.Title?.trim() || null, text };
}

const READERS = {
    '.txt': readPlain, '.text': readPlain,
    '.md': readMarkdown, '.markdown': readMarkdown,
    '.html': readHtml, '.htm': readHtml,
    '.epub': readEpub, '.docx': readDocx, '.pdf': readPdf
};

/**
 * Returns { title, text, chapters } for a supported file, or throws with a
 * message meant to be shown to the user.
 */
export async function extractText(file, options = {}) {
    if (!file) throw new Error('No file given.');

    const extension = extensionOf(file.name);
    const reader = READERS[extension];
    if (!reader) {
        throw new Error(`Cannot read ${extension || 'that file'}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.`);
    }

    const { title, text, chapters = null } = await reader(file, options);
    const cleaned = (options.stripUrls || options.stripCitations)
        ? normalizeText(text, options)
        : text;
    if (!cleaned || cleaned.split(/\s+/).length < 10) {
        throw new Error('That file did not contain enough readable text.');
    }

    // `chapters` is null unless the format carries its own (EPUB).
    return { title: title || titleFromFilename(file.name), text: cleaned, chapters };
}
