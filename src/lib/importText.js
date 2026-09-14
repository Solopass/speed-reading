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

/**
 * Paragraph structure is what the reader renders and what the pacer measures
 * lines from, so blank lines are preserved while runs of whitespace inside a
 * paragraph are collapsed.
 */
export function normalizeText(raw) {
    return String(raw)
        // NFKC folds the compatibility characters that document extraction
        // produces: non-breaking spaces become ordinary ones, and the ligatures
        // PDFs are full of (fi, fl) decompose back into letters.
        .normalize('NFKC')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(line => line.replace(/[ \t]+/g, ' ').trim())
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
        text: normalizeText(text)
    };
}

async function readPlain(file) {
    return { title: null, text: normalizeText(await file.text()) };
}

async function readHtml(file) {
    return extractFromHtml(await file.text());
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
        .map(bytes => extractFromHtml(decode(bytes)).text)
        .filter(Boolean);

    if (!chapters.length) throw new Error('No readable chapters found in that EPUB.');

    return {
        title: opf.querySelector('metadata title')?.textContent?.trim() || null,
        text: normalizeText(chapters.join('\n\n'))
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

/**
 * pdf.js gives positioned text items rather than lines, so this rebuilds
 * paragraphs from vertical gaps: a large jump means a new paragraph, a small
 * one a wrapped line.
 */
async function readPdf(file) {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
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
                else if (gap > 2) text += ' ';
            }
            text += item.str;
            lastY = y;
        }
        pages.push(text);
    }

    const text = normalizeText(pages.join('\n\n'));
    if (!text) throw new Error('No text found in that PDF. Scanned pages need OCR first.');

    return { title: (await pdf.getMetadata().catch(() => null))?.info?.Title?.trim() || null, text };
}

const READERS = {
    '.txt': readPlain, '.text': readPlain, '.md': readPlain, '.markdown': readPlain,
    '.html': readHtml, '.htm': readHtml,
    '.epub': readEpub, '.docx': readDocx, '.pdf': readPdf
};

/**
 * Returns { title, text } for a supported file, or throws with a message meant
 * to be shown to the user.
 */
export async function extractText(file) {
    if (!file) throw new Error('No file given.');

    const extension = extensionOf(file.name);
    const reader = READERS[extension];
    if (!reader) {
        throw new Error(`Cannot read ${extension || 'that file'}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.`);
    }

    const { title, text } = await reader(file);
    if (!text || text.split(/\s+/).length < 10) {
        throw new Error('That file did not contain enough readable text.');
    }

    return { title: title || titleFromFilename(file.name), text };
}
