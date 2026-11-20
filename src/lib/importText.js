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
 * Scrubs extraction artifacts and returns both the cleaned text and counts of
 * what was removed so the Upload UI can show a summary and offer undo.
 */
export function normalizeTextWithStats(raw, { stripUrls = false, stripCitations = false } = {}) {
    const stats = { junkChars: 0, rejoinedHyphens: 0, pageNumbers: 0, dotLeaders: 0 };
    let scrubbed = String(raw)
        .normalize('NFKC')
        .replace(JUNK_CHARS_RE, () => { stats.junkChars += 1; return ''; })
        .replace(ASTRAL_PUA_RE, () => { stats.junkChars += 1; return ''; })
        .replace(/\r\n?/g, '\n')
        .replace(/([A-Za-z]{2,})-[ \t]*\n[ \t]*([a-z]{2,})/g, (_, a, b) => {
            stats.rejoinedHyphens += 1;
            return `${a}${b}`;
        });

    if (stripUrls) scrubbed = scrubbed.replace(URL_RE, '');
    if (stripCitations) scrubbed = scrubbed.replace(CITATION_RE, '');
    if (stripUrls || stripCitations) scrubbed = scrubbed.replace(/[ \t]+([,.;:!?])/g, '$1');

    const rawLines = scrubbed.split('\n');
    const multiLine = rawLines.length > 2;
    const cuts = [];

    const text = rawLines
        .map((line, lineIdx) => {
            let clean = line
                .replace(LEADING_BULLET_RE, '')
                .replace(/\.{4,}/g, () => { stats.dotLeaders += 1; return ' '; })
                .replace(STRAY_SYMBOL_TOKEN_RE, '$1')
                .replace(/[ \t]+/g, ' ')
                .trim();
            if (!clean) return '';
            if (DIVIDER_LINE_RE.test(clean)) {
                cuts.push({ id: `det-${lineIdx}-div`, index: lineIdx, text: clean, reason: 'Divider', source: 'auto' });
                return '';
            }
            if (multiLine && (PAGE_NUMBER_RE.test(clean) || /^\d{1,4}$/.test(clean))) {
                stats.pageNumbers += 1;
                cuts.push({ id: `det-${lineIdx}-pg`, index: lineIdx, text: clean, reason: 'Page number', source: 'auto' });
                return '';
            }
            return clean;
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return { text, stats, cuts };
}

/**
 * Picks blocks for AI cleanup: all paragraphs for normal documents (<= maxBlocks),
 * or front/back matter + suspect short/noisy blocks for long books.
 */
export function selectBlocksForAiClean(text, maxBlocks = 60) {
    const paragraphs = String(text ?? '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    if (paragraphs.length <= maxBlocks) {
        return paragraphs.map((p, index) => ({ index, text: p }));
    }

    const picked = new Map();
    const edge = 15;
    for (let i = 0; i < Math.min(edge, paragraphs.length); i++) picked.set(i, paragraphs[i]);
    for (let i = Math.max(edge, paragraphs.length - edge); i < paragraphs.length; i++) picked.set(i, paragraphs[i]);

    for (let i = edge; i < paragraphs.length - edge && picked.size < maxBlocks; i++) {
        const p = paragraphs[i];
        const words = p.split(/\s+/).length;
        const noisy = /https?:\/\/|copyright|all rights reserved|table of contents|\bISBN\b/i.test(p)
            || (words <= 6 && !/[.!?]$/.test(p));
        if (noisy) picked.set(i, p);
    }

    return [...picked.entries()].sort((a, b) => a[0] - b[0]).map(([index, p]) => ({ index, text: p }));
}

/** Splits the full document into chunks of { index, text } blocks for thorough multi-pass AI cleanup. */
export function chunkBlocksForAiClean(text, chunkSize = 60) {
    const paragraphs = String(text ?? '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const chunks = [];
    for (let i = 0; i < paragraphs.length; i += chunkSize) {
        chunks.push(paragraphs.slice(i, i + chunkSize).map((p, j) => ({ index: i + j, text: p })));
    }
    return chunks;
}

/** Applies AI cut indices to paragraph-separated text, returning new text and cut items for diff review. */
export function applyParagraphCuts(text, cuts = []) {
    const paragraphs = String(text ?? '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const byIndex = new Map();
    for (const c of cuts) {
        if (Number.isInteger(c?.index) && c.index >= 0 && c.index < paragraphs.length && !byIndex.has(c.index)) {
            byIndex.set(c.index, String(c.reason || 'Clutter').trim().slice(0, 60));
        }
    }
    const kept = [];
    const cutItems = [];
    paragraphs.forEach((p, idx) => {
        if (byIndex.has(idx)) {
            cutItems.push({ id: `ai-${Date.now()}-${idx}`, index: idx, text: p, reason: `AI: ${byIndex.get(idx)}`, source: 'ai' });
        } else {
            kept.push(p);
        }
    });
    return { text: kept.join('\n\n'), cutItems };
}

/** Reinserts a previously cut item back into the document text at its original paragraph position. */
export function restoreCutItem(text, cutItem) {
    const paragraphs = String(text ?? '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const at = Math.max(0, Math.min(paragraphs.length, Number.isInteger(cutItem?.index) ? cutItem.index : paragraphs.length));
    paragraphs.splice(at, 0, cutItem.text);
    return paragraphs.join('\n\n');
}

/**
 * Paragraph structure is what the reader renders and what the pacer measures
 * lines from, so blank lines are preserved while runs of whitespace inside a
 * paragraph are collapsed and extraction artifacts are scrubbed.
 */
export function normalizeText(raw, options = {}) {
    return normalizeTextWithStats(raw, options).text;
}

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, dd, dt, figcaption';

const BOILERPLATE_SELECTOR = 'script, style, noscript, nav, header, footer, aside, svg, form, button, dialog, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"]';

function pickArticleRoot(doc) {
    const candidates = [...doc.querySelectorAll('article, main, [role="main"]')];
    let best = null;
    let bestWords = 0;
    for (const el of candidates) {
        const words = (el.textContent || '').trim().split(/\s+/).filter(Boolean).length;
        if (words >= 60 && words > bestWords) {
            best = el;
            bestWords = words;
        }
    }
    if (best) return best;

    // Fallback: pick the container with the most paragraph prose.
    let bestContainer = doc.body ?? doc.documentElement;
    let bestScore = 0;
    for (const container of doc.querySelectorAll('div, section')) {
        const pChars = [...container.querySelectorAll(':scope > p')]
            .reduce((sum, p) => sum + p.textContent.trim().length, 0);
        if (pChars > bestScore) {
            bestScore = pChars;
            bestContainer = container;
        }
    }
    return bestContainer;
}

/**
 * Pulls prose out of an HTML document. Block elements become paragraphs, so the
 * result keeps the shape the reader needs; prefers <article>/<main> or the
 * richest paragraph container so navigation/banners are skipped.
 */
export function extractFromHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll(BOILERPLATE_SELECTOR).forEach(el => el.remove());

    const root = pickArticleRoot(doc);
    const blocks = [...(root?.querySelectorAll(BLOCK_SELECTOR) ?? [])]
        // Skip wrappers whose text is already covered by a nested block.
        .filter(el => !el.querySelector(BLOCK_SELECTOR))
        .map(el => el.textContent.trim())
        .filter(Boolean);

    const text = blocks.length ? blocks.join('\n\n') : (root?.textContent ?? '');
    return {
        title: doc.querySelector('title')?.textContent?.trim() || null,
        // The first heading names the chapter when this is one EPUB spine file.
        heading: root?.querySelector('h1, h2, h3')?.textContent?.replace(/\s+/g, ' ').trim()
            || doc.querySelector('h1, h2, h3')?.textContent?.replace(/\s+/g, ' ').trim()
            || null,
        text: normalizeText(text)
    };
}

async function readPlain(file, options) {
    const rawText = await file.text();
    const { text, stats, cuts } = normalizeTextWithStats(rawText, options);
    return { title: null, text, rawText, stats, cuts };
}

async function readMarkdown(file, options) {
    const rawText = await file.text();
    const { text, stats, cuts } = normalizeTextWithStats(stripMarkdown(rawText), options);
    return { title: null, text, rawText, stats, cuts };
}

async function readHtml(file, options) {
    const res = extractFromHtml(await file.text());
    const { text, stats, cuts } = normalizeTextWithStats(res.text, options);
    return { ...res, text, rawText: res.text, stats, cuts };
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
async function readDocx(file, options) {
    const { unzipSync } = await import('fflate');
    const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));

    const documentXml = zip['word/document.xml'];
    if (!documentXml) throw new Error('That .docx has no document body — the file may be corrupt.');

    const doc = new DOMParser().parseFromString(decode(documentXml), 'application/xml');
    const paragraphs = [...doc.getElementsByTagName('w:p')]
        .map(p => {
            const text = [...p.getElementsByTagName('w:t')].map(t => t.textContent).join('').trim();
            if (!text) return '';
            const style = p.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') ?? '';
            if (/^(Heading1|Title)$/i.test(style)) return `# ${text}`;
            if (/^Heading[2-3]$/i.test(style)) return `## ${text}`;
            return text;
        })
        .filter(Boolean);

    if (!paragraphs.length) throw new Error('That .docx appears to contain no text.');
    const rawText = paragraphs.join('\n\n');
    const { text, stats, cuts } = normalizeTextWithStats(rawText, options);
    return { title: null, text, rawText, stats, cuts };
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

function sortReadingOrder(items) {
    // Group into lines first (transitive) so slightly tilted OCR baselines stay in X order.
    const byYDesc = [...items].sort((a, b) => b.transform[5] - a.transform[5]);
    const lines = [];
    for (const it of byYDesc) {
        const y = it.transform[5];
        const lastLine = lines[lines.length - 1];
        if (lastLine && Math.abs(lastLine.y - y) <= 4) {
            lastLine.items.push(it);
        } else {
            lines.push({ y, items: [it] });
        }
    }
    return lines.flatMap(l => l.items.sort((a, b) => a.transform[4] - b.transform[4]));
}

/**
 * Reorders PDF text items into reading order. Only splits into two columns when
 * a real empty vertical gutter exists down the middle of the page.
 */
export function orderPdfItems(items, pageWidth = 600) {
    const textItems = items.filter(it => it && 'str' in it && it.str.trim() && Array.isArray(it.transform));
    if (textItems.length < 8) return items;

    const mid = pageWidth * 0.5;
    const gutterPad = Math.max(10, pageWidth * 0.025);
    const gutterLeft = mid - gutterPad;
    const gutterRight = mid + gutterPad;

    const left = [];
    const right = [];
    let gutterHits = 0;

    for (const it of textItems) {
        const x = it.transform[4];
        const w = it.width ?? 0;
        const endX = x + w;
        if (x < gutterRight && endX > gutterLeft) gutterHits += 1;
        else if (endX <= gutterLeft) left.push(it);
        else if (x >= gutterRight) right.push(it);
    }

    const isTwoCol = gutterHits <= 2 && left.length >= 8 && right.length >= 8;
    if (!isTwoCol) return sortReadingOrder(textItems);
    return sortReadingOrder(left).concat(sortReadingOrder(right));
}

/**
 * Reconstructs prose from ordered pdf.js text items, inserting spaces for
 * horizontal word gaps on the same line and newlines for wrapped/paragraph breaks.
 */
export function assemblePdfPageText(ordered) {
    let text = '';
    let lastY = null;
    let lastEndX = null;

    for (const item of ordered) {
        if (!item || !('str' in item) || !Array.isArray(item.transform)) continue;
        const x = item.transform[4];
        const y = item.transform[5];
        const fontSize = Math.abs(item.transform[3] || item.transform[0] || 10);
        const width = (typeof item.width === 'number' && item.width > 0)
            ? item.width
            : item.str.length * fontSize * 0.45;

        if (lastY !== null) {
            const yGap = Math.abs(lastY - y);
            const paraGap = Math.max(14, fontSize * 1.55);
            const lineGap = Math.max(4, fontSize * 0.35);
            if (yGap > paraGap) {
                text += '\n\n';
            } else if (yGap > lineGap) {
                text += '\n';
            } else if (lastEndX !== null) {
                const xGap = x - lastEndX;
                if (xGap > Math.max(1.5, fontSize * 0.14) && !/\s$/.test(text) && !/^[\s,.;:!?)\]]/.test(item.str)) {
                    text += ' ';
                }
            }
        }
        text += item.str;
        lastY = y;
        lastEndX = x + width;
    }
    return text;
}

async function pdfOutlineChapters(pdf, cleanPages) {
    try {
        const outline = await pdf.getOutline();
        if (!Array.isArray(outline) || outline.length < 2) return null;

        const entries = [];
        const seenPages = new Set();
        for (const item of outline) {
            if (!item?.title || !item.dest) continue;
            const dest = typeof item.dest === 'string'
                ? await pdf.getDestination(item.dest).catch(() => null)
                : item.dest;
            const ref = Array.isArray(dest) ? dest[0] : null;
            if (!ref) continue;
            const pageIndex = await pdf.getPageIndex(ref).catch(() => -1);
            if (pageIndex >= 0 && pageIndex < cleanPages.length && !seenPages.has(pageIndex)) {
                seenPages.add(pageIndex);
                entries.push({ title: item.title.trim(), pageIndex });
            }
        }
        if (entries.length < 2) return null;

        entries.sort((a, b) => a.pageIndex - b.pageIndex);
        const chapters = [];
        if (entries[0].pageIndex > 0) {
            const opening = normalizeText(cleanPages.slice(0, entries[0].pageIndex).join('\n\n'));
            if (opening) chapters.push({ title: 'Opening', text: opening });
        }
        for (let i = 0; i < entries.length; i++) {
            const start = entries[i].pageIndex;
            const end = i + 1 < entries.length ? entries[i + 1].pageIndex : cleanPages.length;
            const text = normalizeText(cleanPages.slice(start, end).join('\n\n'));
            if (text) chapters.push({ title: entries[i].title, text });
        }
        return chapters.length >= 2 ? chapters : null;
    } catch {
        return null;
    }
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
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const ordered = orderPdfItems(content.items, viewport.width);
        pages.push(assemblePdfPageText(ordered));
        if (pageNumber % 4 === 0) await new Promise(r => setTimeout(r, 0));
    }

    const strippedPages = stripRepeatedHeadersFooters(pages);
    const removedHeaders = pages.reduce((n, p, i) => (p !== strippedPages[i] ? n + 1 : n), 0);
    const rawText = pages.join('\n\n');
    const { text, stats, cuts } = normalizeTextWithStats(strippedPages.join('\n\n'), options);
    if (!text) {
        throw new Error(`This PDF (${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}) appears to be scanned images with no selectable text. Run OCR (e.g. Adobe, macOS Preview, or ocrmypdf) first, then re-upload.`);
    }

    const chapters = await pdfOutlineChapters(pdf, strippedPages);
    return {
        title: (await pdf.getMetadata().catch(() => null))?.info?.Title?.trim() || null,
        text,
        rawText,
        chapters,
        cuts,
        stats: { ...stats, repeatedHeaders: removedHeaders }
    };
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

    const { title, text, chapters = null, rawText = null, stats = null, cuts = [] } = await reader(file, options);
    const cleaned = (options.stripUrls || options.stripCitations)
        ? normalizeText(text, options)
        : text;
    if (!cleaned || cleaned.split(/\s+/).length < 10) {
        throw new Error('That file did not contain enough readable text.');
    }

    // `chapters` is null unless the format carries its own (EPUB or PDF outline).
    return { title: title || titleFromFilename(file.name), text: cleaned, chapters, rawText, stats, cuts };
}
