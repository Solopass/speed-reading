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
        .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '')          // reference link definitions
        .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')            // reference-style links
        .replace(/<\/?[a-zA-Z][^>]*>/g, '')                   // inline HTML tags
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^\s*>\s?/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '')                       // list bullets
        // Emphasis only where it opens and closes at word boundaries, so
        // snake_case_names and 2*3*4 are left alone.
        .replace(/(^|[^\w*])(\*\*|__)(?=\S)(.+?)(?<=\S)\2(?![\w*])/g, '$1$3')
        .replace(/(^|[^\w*])(\*|_)(?=\S)(.+?)(?<=\S)\2(?![\w*])/g, '$1$3');
}

/** Markdown paragraphs tagged with heading level (1 for #, 2 for ## and ###), for chapter splitting. */
function markdownParagraphs(raw) {
    return String(raw)
        .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
        // Headings become paragraphs of their own even without blank lines around them.
        .replace(/^(#{1,6}[ \t]+.*)$/gm, '\n$1\n')
        .split(/\n\s*\n/)
        .map(block => {
            const match = block.trim().match(/^(#{1,6})[ \t]+(.*)$/);
            const level = match ? (match[1].length === 1 ? 1 : match[1].length <= 3 ? 2 : 0) : 0;
            return { text: normalizeText(stripMarkdown(block.trim())), level };
        })
        .filter(p => p.text);
}

const URL_RE = /https?:\/\/\S+/gi;
const CITATION_RE = /\[\d+(?:[\s,\-–]+\d+)*\]/g;

/**
 * Scrubs extraction artifacts and returns both the cleaned text and counts of
 * what was removed so the Upload UI can show a summary and offer undo.
 */
export function normalizeTextWithStats(raw, { stripUrls = false, stripCitations = false, stripPageNumbers = false, reflow = false } = {}) {
    const stats = { junkChars: 0, rejoinedHyphens: 0, pageNumbers: 0, dotLeaders: 0 };
    let scrubbed = String(raw)
        // Superscript footnote markers right after punctuation ("end.¹"). NFKC
        // would turn them into plain digits glued to the word ("end.1").
        .replace(/([.,;:!?"'”’])[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, '$1')
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
    // The last kept line, so a removed line can be put back next to it.
    let lastKept = null;
    let paraIdx = 0;
    let inPara = false;
    const REMOVED = null;

    let text = rawLines
        .map((line, lineIdx) => {
            let clean = line
                .replace(LEADING_BULLET_RE, '')
                .replace(/\.{4,}/g, () => { stats.dotLeaders += 1; return ' '; })
                .replace(STRAY_SYMBOL_TOKEN_RE, '$1')
                .replace(/[ \t]+/g, ' ')
                // Extraction spacing that leaves punctuation as a word of its own,
                // which the reader would flash alone: "word ," / "( this )" / ". . ."
                .replace(/(?<=[\p{L}\p{N}])\s?\.\s\.\s\.(?!\S)/gu, '…')
                .replace(/(?<=[\p{L}\p{N}%"”’)])[ ]+([,;)\]”’]+)(?=\s|$)/gu, '$1')
                .replace(/(?<=\p{L}{2})[ ]+([.!?])(?=[ ]+[\p{Lu}"“‘]|$)/gu, '$1')
                .replace(/(^|\s)([([“‘])[ ]+(?=[\p{L}\p{N}])/gu, '$1$2')
                // A spaced hyphen or double hyphen between words is a dash.
                // Between numbers it is a minus or a range ("5 - 3", "10 - 20"), so left alone.
                .replace(/(?<=\p{L}{2}[,.;:!?"”’)]?)[ ](?:--?|–)[ ](?=[\p{L}"“‘(]\p{L})/gu, ' — ')
                .trim();
            // A line that was blank is a paragraph break; one emptied by cleaning just goes.
            if (!clean) {
                if (line.trim()) return REMOVED;
                if (inPara) { paraIdx += 1; inPara = false; }
                return '';
            }
            if (DIVIDER_LINE_RE.test(clean)) {
                cuts.push({ id: `det-${lineIdx}-div`, index: paraIdx, text: clean, reason: 'Divider', source: 'auto', after: lastKept ? [lastKept] : [] });
                return REMOVED;
            }
            // Only PDFs have page furniture. In any other format a line that is
            // just "1" or "12" is far more likely a chapter number to keep.
            if (stripPageNumbers && multiLine && (PAGE_NUMBER_RE.test(clean) || /^\d{1,4}$/.test(clean))) {
                stats.pageNumbers += 1;
                cuts.push({ id: `det-${lineIdx}-pg`, index: paraIdx, text: clean, reason: 'Page number', source: 'auto', after: lastKept ? [lastKept] : [] });
                return REMOVED;
            }
            lastKept = clean;
            inPara = true;
            return clean;
        })
        // A removed line disappears; it must not leave a blank line behind, which
        // would split the paragraph it sat in (a page number between two wrapped lines).
        .filter(line => line !== REMOVED)
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    if (reflow) text = reflowParagraphs(text);

    return { text, stats, cuts };
}

/**
 * Rebuilds prose paragraphs from wrapped lines (PDF text keeps one line per
 * printed line). A full-width line wraps into the next one; a short line that
 * ends a sentence ends the paragraph (books often mark paragraphs by indent
 * rather than a gap, which text extraction cannot see); a short unpunctuated
 * line before a capital is a heading. Blocks of short lines (lists, verse,
 * contents pages) are left as they are.
 */
export function reflowParagraphs(text) {
    return String(text ?? '').split(/\n\s*\n/).map(block => {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) return lines.join('');
        const maxLen = Math.max(...lines.map(l => l.length));
        if (maxLen < 35) return lines.join('\n');
        let out = lines[0];
        const short = (l) => l.length < maxLen * 0.6;
        let list = false;
        for (let i = 1; i < lines.length; i++) {
            const prev = lines[i - 1];
            const next = lines[i];
            // Short lines after "...the following:" are a list: one item per line.
            list = list ? short(prev) : (/[:;]$/.test(prev) && short(next));
            if (list) { out += `\n${next}`; continue; }
            const full = prev.length >= maxLen * 0.72;
            const endsSentence = /[.!?…]["'”’)\]]*$/.test(prev);
            const heading = prev.length < maxLen * 0.6 && prev.split(/\s+/).length <= 10
                && !/[.,;:!?…"'”’)\]-]$/.test(prev) && /^[\p{Lu}\p{N}"“‘(]/u.test(next);
            if (/-$/.test(prev) && /^\p{Ll}/u.test(next)) out += next;
            else if (full) out += ` ${next}`;
            else if (endsSentence || heading) out += `\n\n${next}`;
            else out += ` ${next}`;
        }
        return out;
    }).join('\n\n');
}

const splitParas = (text) => String(text ?? '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

/** A loose identity for a paragraph: survives punctuation and spacing clean-up. */
const paraKey = (p) => String(p).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const sameParagraph = (a, b) => {
    if (!a || !b) return false;
    if (a === b) return true;
    // Long paragraphs may have been tidied a little; their openings still match.
    return a.length >= 30 && b.length >= 30 && a.slice(0, 60) === b.slice(0, 60);
};

/**
 * Re-splits (cleaned) text into a file's own chapters. Each chapter is found
 * by its opening paragraphs, so cleaning, AI cuts and hand edits keep the
 * chapters instead of saving the original, uncleaned chapter texts. A chapter
 * whose opening cannot be found is merged into the one before it.
 */
export function chaptersFromAnchors(text, chapters) {
    if (!Array.isArray(chapters) || chapters.length < 2) return null;
    const paras = splitParas(text);
    const keys = paras.map(paraKey);
    const starts = [];
    // Chapter one owns at least the first paragraph.
    let from = 1;
    chapters.forEach((ch, ci) => {
        if (ci === 0) { starts.push({ ci, at: 0 }); return; }
        const own = splitParas(ch.text).slice(0, 5).map(paraKey);
        // A real paragraph of prose is a far safer anchor than a heading, which
        // also appears in a contents page. A short candidate only counts when
        // the chapter's following paragraph comes right after it too.
        const order = own.map((k, j) => ({ k, j })).filter(c => c.k)
            .sort((a, b) => (b.k.split(' ').length >= 6) - (a.k.split(' ').length >= 6) || a.j - b.j);
        for (const { k, j } of order) {
            const short = k.split(' ').length < 6;
            const at = keys.findIndex((key, i) => i >= from && sameParagraph(key, k)
                && (!short || !own[j + 1] || sameParagraph(keys[i + 1], own[j + 1])));
            if (at < 0) continue;
            // Walk back over the chapter's earlier paragraphs (its heading) when they are still there.
            let start = at;
            for (let b = j - 1; b >= 0 && start - 1 >= from && sameParagraph(keys[start - 1], own[b]); b--) start -= 1;
            starts.push({ ci, at: start });
            from = at + 1;
            return;
        }
    });
    const out = [];
    for (let i = 0; i < starts.length; i++) {
        const end = i + 1 < starts.length ? starts[i + 1].at : paras.length;
        const body = paras.slice(starts[i].at, end).join('\n\n');
        if (body.trim()) out.push({ title: chapters[starts[i].ci].title, text: body });
    }
    return out.length >= 2 ? out : null;
}

/** The block number from an AI cut; NaN for null, empty or missing (Number(null) would be 0). */
export function aiCutIndex(cut) {
    const v = cut?.index;
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '') return Number(v);
    return NaN;
}

/** Things an AI may cut even when they read like sentences. */
const BOILERPLATE_RE = /copyright|©|all rights reserved|\bisbn\b|cookies?\b|subscribe|newsletter|privacy policy|terms of (?:use|service)|table of contents|bibliograph|works cited|\breferences\b|\bdoi\b|https?:\/\/|sign up|log ?in\b|advertisement|sponsored/i;
const HEADING_RE = /^(?:chapter|part|book|section|prologue|epilogue|introduction|preface|foreword|afterword|appendix)\b|^[IVXLC]+\.?$|^\d{1,3}\.?$/i;

function looksLikeProse(p) {
    const words = p.split(/\s+/).filter(Boolean);
    if (words.length < 40) return false;
    const sentences = (p.match(/[.!?]["'”’)]?(?=\s|$)/g) ?? []).length;
    const digits = (p.match(/\d/g) ?? []).length / Math.max(1, p.length);
    return sentences >= 2 && digits < 0.06;
}

/**
 * Checks an AI's cut list before anything is removed. A cut is kept only if
 * its index was one of the blocks the AI was shown (a model that numbers the
 * list from 0 would otherwise delete unrelated paragraphs of a long book),
 * and never for a chapter heading or a paragraph of ordinary prose.
 * Returns { accepted: [{ index, reason }], skipped: [{ index, why }] }.
 */
export function validateAiCuts(rawCuts, blocks, text) {
    const shown = new Set((blocks ?? []).map(b => b.index));
    const paragraphs = splitParas(text);
    const accepted = [];
    const skipped = [];
    const seen = new Set();
    for (const c of Array.isArray(rawCuts) ? rawCuts : []) {
        const index = aiCutIndex(c);
        if (!Number.isInteger(index) || seen.has(index)) continue;
        seen.add(index);
        const p = paragraphs[index];
        if (!shown.has(index) || !p) { skipped.push({ index, why: 'not one of the blocks it was shown' }); continue; }
        if (p.split(/\s+/).length <= 8 && HEADING_RE.test(p.trim())) { skipped.push({ index, why: 'a chapter heading' }); continue; }
        if (looksLikeProse(p) && !BOILERPLATE_RE.test(p)) { skipped.push({ index, why: 'ordinary prose' }); continue; }
        accepted.push({ index, reason: String(c?.reason || 'Clutter') });
    }
    return { accepted, skipped };
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
            cutItems.push({
                id: `ai-${Date.now()}-${idx}`, index: idx, text: p, reason: `AI: ${byIndex.get(idx)}`, source: 'ai',
                // Neighbours (nearest first), so a restore lands in the right place
                // even after other cuts and restores have shifted the indices.
                after: paragraphs.slice(Math.max(0, idx - 3), idx).reverse(),
                before: paragraphs[idx + 1] ?? null
            });
        } else {
            kept.push(p);
        }
    });
    return { text: kept.join('\n\n'), cutItems };
}

/** Reinserts a previously cut item back into the document text at its original paragraph position. */
export function restoreCutItem(text, cutItem) {
    const paragraphs = splitParas(text);
    const keys = paragraphs.map(paraKey);
    const hint = Number.isInteger(cutItem?.index) ? cutItem.index : paragraphs.length;
    // The matching paragraph nearest the original position; a line (a page
    // number's neighbour) matches the paragraph that contains it.
    const find = (anchor) => {
        const k = paraKey(anchor ?? '');
        if (!k) return -1;
        let best = -1;
        keys.forEach((key, i) => {
            if (sameParagraph(key, k) || (k.length >= 6 && key.includes(k))) {
                if (best < 0 || Math.abs(i - hint) < Math.abs(best - hint)) best = i;
            }
        });
        return best;
    };
    let at = -1;
    for (const anchor of cutItem?.after ?? []) {
        const i = find(anchor);
        if (i >= 0) { at = i + 1; break; }
    }
    if (at < 0 && cutItem?.before) {
        const i = find(cutItem.before);
        if (i >= 0) at = i;
    }
    if (at < 0) at = Math.max(0, Math.min(paragraphs.length, hint));
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

    // Fallback: the container with the most paragraph prose, but only when it
    // really holds most of the page's prose. Articles that spread paragraphs
    // over several sibling wrappers would otherwise lose every wrapper but one.
    const body = doc.body ?? doc.documentElement;
    const proseIn = (el) => [...el.querySelectorAll('p')].reduce((sum, p) => sum + p.textContent.trim().length, 0);
    const totalProse = proseIn(body);
    let bestContainer = body;
    let bestScore = 0;
    for (const container of doc.querySelectorAll('div, section')) {
        const pChars = [...container.querySelectorAll(':scope > p')]
            .reduce((sum, p) => sum + p.textContent.trim().length, 0);
        if (pChars > bestScore) {
            bestScore = pChars;
            bestContainer = container;
        }
    }
    return totalProse > 0 && proseIn(bestContainer) >= totalProse * 0.6 ? bestContainer : body;
}

/** Light cleanup for EPUB chapters: they have no site furniture, and <header> often holds the chapter title. */
const EPUB_BOILERPLATE_SELECTOR = 'script, style, noscript, svg, nav, [epub\\:type="pagebreak"]';

/**
 * Pulls prose out of an HTML document. Block elements become paragraphs, so the
 * result keeps the shape the reader needs; prefers <article>/<main> or the
 * richest paragraph container so navigation/banners are skipped.
 */
export function extractFromHtml(html, { article = true } = {}) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll(article ? BOILERPLATE_SELECTOR : EPUB_BOILERPLATE_SELECTOR).forEach(el => el.remove());

    // A web page needs its article found; an EPUB chapter file is the content.
    const root = article ? pickArticleRoot(doc) : (doc.body ?? doc.documentElement);
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

/**
 * Decodes a text file. Most are UTF-8, but older Windows files are often
 * Windows-1252 and some editors save UTF-16; decoding those as UTF-8 turned
 * every accented letter into a replacement character, which the scrubber then
 * deleted ("café" became "caf").
 */
export function decodeTextBytes(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
    if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(b);
    } catch {
        return new TextDecoder('windows-1252').decode(b);
    }
}

async function readTextFile(file) {
    return decodeTextBytes(new Uint8Array(await file.arrayBuffer()));
}

async function readPlain(file, options) {
    const rawText = await readTextFile(file);
    const { text, stats, cuts } = normalizeTextWithStats(rawText, options);
    return { title: null, text, rawText, stats, cuts };
}

async function readMarkdown(file, options) {
    const rawText = await readTextFile(file);
    const { text, stats, cuts } = normalizeTextWithStats(stripMarkdown(rawText), options);
    return { title: null, text, rawText, stats, cuts, chapters: chaptersFromHeadings(markdownParagraphs(rawText), options) };
}

async function readHtml(file, options) {
    const res = extractFromHtml(await readTextFile(file));
    const { text, stats, cuts } = normalizeTextWithStats(res.text, options);
    return { ...res, text, rawText: res.text, stats, cuts };
}

const decode = (bytes) => new TextDecoder('utf-8').decode(bytes);

/**
 * EPUB is a zip: container.xml points at the OPF package, whose spine gives the
 * reading order. Following the spine matters — zip entry order is arbitrary, so
 * reading files as they appear can shuffle the chapters.
 */
async function readEpub(file, options = {}) {
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
        .map(bytes => extractFromHtml(decode(bytes), { article: false }))
        .filter(ch => ch.text);

    if (!chapters.length) throw new Error('No readable chapters found in that EPUB.');

    const rawText = chapters.map(ch => ch.text).join('\n\n');
    const { text, stats, cuts } = normalizeTextWithStats(rawText, options);
    return {
        title: opf.querySelector('metadata title')?.textContent?.trim() || null,
        text,
        rawText,
        stats,
        cuts,
        // Kept separate as well, so book mode can use the file's own chapters.
        chapters: chapters
            .map((ch, i) => ({ title: ch.heading || `Chapter ${i + 1}`, text: normalizeText(ch.text, options) }))
            .filter(ch => ch.text)
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
            const text = docxParagraphText(p);
            if (!text) return null;
            const style = p.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') ?? '';
            const level = /^(Heading1|Title)$/i.test(style) ? 1 : /^Heading[23]$/i.test(style) ? 2 : 0;
            return { text, level };
        })
        .filter(Boolean);

    if (!paragraphs.length) throw new Error('That .docx appears to contain no text.');
    const rawText = paragraphs.map(p => p.text).join('\n\n');
    const { text, stats, cuts } = normalizeTextWithStats(rawText, options);
    return { title: null, text, rawText, stats, cuts, chapters: chaptersFromHeadings(paragraphs, options) };
}

/**
 * A Word paragraph's text in document order. Tabs and line breaks are their
 * own elements, not characters inside <w:t>, so reading only <w:t> glued the
 * words either side of them together.
 */
function docxParagraphText(p) {
    let out = '';
    for (const el of p.getElementsByTagName('*')) {
        const name = el.nodeName;
        if (name === 'w:t') out += el.textContent;
        else if (name === 'w:tab' || name === 'w:br' || name === 'w:cr') out += ' ';
        else if (name === 'w:noBreakHyphen') out += '-';
    }
    return out.replace(/\s+/g, ' ').trim();
}

/**
 * Chapters from heading-tagged paragraphs ({ text, level }), splitting on the
 * top heading level that occurs at least twice. Null when there are not enough
 * headings to be worth it; book mode then falls back to its own detection.
 */
export function chaptersFromHeadings(paragraphs, options = {}) {
    const level = [1, 2].find(l => paragraphs.filter(p => p.level === l).length >= 2);
    if (!level) return null;
    const chapters = [];
    let current = null;
    for (const p of paragraphs) {
        if (p.level === level) {
            if (current) chapters.push(current);
            current = { title: p.text.slice(0, 120), parts: [p.text] };
        } else {
            if (!current) current = { title: 'Opening', parts: [] };
            current.parts.push(p.text);
        }
    }
    if (current) chapters.push(current);
    const result = chapters
        .map(c => ({ title: c.title, text: normalizeText(c.parts.join('\n\n'), options) }))
        .filter(c => c.text);
    return result.length >= 2 ? result : null;
}

const headerKey = (line) => line.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Removes running headers and footers that repeat across many PDF pages
 * (including odd/even alternating headers or headers with changing page numbers).
 */
export function stripRepeatedHeadersFooters(pages) {
    if (!Array.isArray(pages) || pages.length < 3) return pages ?? [];

    // Lines are kept with their blank separators, so stripping a header or
    // footer leaves the page's own line and paragraph breaks exactly as they were.
    const splitPages = pages.map(p => String(p).split('\n'));
    const firstLine = (lines) => lines.find(l => l.trim()) ?? '';
    const lastLine = (lines) => [...lines].reverse().find(l => l.trim()) ?? '';
    const counts = new Map();

    for (const lines of splitPages) {
        const seenOnPage = new Set();
        for (const raw of [firstLine(lines), lastLine(lines)]) {
            const candidate = raw.trim();
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

    const isRepeated = (line) => line.trim().length <= 100 && repeated.has(headerKey(line));
    return splitPages.map(lines => {
        const next = [...lines];
        const first = next.findIndex(l => l.trim());
        if (first !== -1 && isRepeated(next[first])) next.splice(first, 1);
        let last = next.length - 1;
        while (last >= 0 && !next[last].trim()) last -= 1;
        if (last >= 0 && isRepeated(next[last])) next.splice(last, 1);
        return next.join('\n').trim();
    });
}

/**
 * Joins page texts. A paragraph that runs over a page break (the page ends
 * mid-sentence and the next starts in lower case) is joined with a space
 * instead of being split into two paragraphs.
 */
export function joinPdfPages(pages) {
    let out = '';
    for (const page of pages.map(p => String(p).trim()).filter(Boolean)) {
        if (!out) { out = page; continue; }
        const continues = !/[.!?:;"'”’)\]]$/.test(out) && /^[a-z(“"'‘]/.test(page);
        // A word hyphenated across the break joins with a newline, which the
        // normaliser's hyphen rejoin then turns back into one word.
        const hyphenated = /[A-Za-z]{2,}-$/.test(out) && /^[a-z]{2,}/.test(page);
        out += hyphenated ? '\n' : continues ? ' ' : '\n\n';
        out += page;
    }
    return out;
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

async function pdfOutlineChapters(pdf, cleanPages, options = {}) {
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
            if (ref === null || ref === undefined) continue;
            // Some PDFs give the page as a plain 0-based number instead of a reference.
            const pageIndex = Number.isInteger(ref) ? ref : await pdf.getPageIndex(ref).catch(() => -1);
            if (pageIndex >= 0 && pageIndex < cleanPages.length && !seenPages.has(pageIndex)) {
                seenPages.add(pageIndex);
                entries.push({ title: item.title.trim(), pageIndex });
            }
        }
        if (entries.length < 2) return null;

        entries.sort((a, b) => a.pageIndex - b.pageIndex);
        const chapters = [];
        if (entries[0].pageIndex > 0) {
            const opening = normalizeText(joinPdfPages(cleanPages.slice(0, entries[0].pageIndex)), options);
            if (opening) chapters.push({ title: 'Opening', text: opening });
        }
        for (let i = 0; i < entries.length; i++) {
            const start = entries[i].pageIndex;
            const end = i + 1 < entries.length ? entries[i + 1].pageIndex : cleanPages.length;
            const text = normalizeText(joinPdfPages(cleanPages.slice(start, end)), options);
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
    try {
        return await readPdfPages(pdf, options);
    } finally {
        // Releases the pdf.js worker and its memory; without this every import leaked one.
        pdf.destroy?.();
    }
}

async function readPdfPages(pdf, options) {
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
    const removedHeaders = pages.reduce((n, p, i) => (p.trim() !== strippedPages[i] ? n + 1 : n), 0);
    const rawText = pages.join('\n\n');
    const pdfOptions = { ...options, stripPageNumbers: true, reflow: true };
    const { text, stats, cuts } = normalizeTextWithStats(joinPdfPages(strippedPages), pdfOptions);
    if (!text) {
        throw new Error(`This PDF (${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}) appears to be scanned images with no selectable text. Run OCR (e.g. Adobe, macOS Preview, or ocrmypdf) first, then re-upload.`);
    }

    const chapters = await pdfOutlineChapters(pdf, strippedPages, pdfOptions);
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
