// One import path for every way a file comes in (picked, dropped, or added
// from the Free books shelf): read it, then decide whether it is a book with
// chapters or a single passage.

import { extractText } from './importText';
import { BOOK_MIN_WORDS, buildChapters, createBook } from './book';

let seq = 0;
/** Ids that stay unique within one batch: several files can finish in the same millisecond. */
export const newDocumentId = (prefix) => {
    seq += 1;
    return `${prefix}-${Date.now()}-${seq.toString(36)}`;
};

const countWords = (text) => (String(text ?? '').trim() ? String(text).trim().split(/\s+/).length : 0);

/**
 * Turns extracted text ({ title, text, chapters }) into what gets saved:
 * a book when it is long or has its own chapters and they come to at least
 * two, otherwise a passage.
 */
export function documentFromExtract(res, { title = res?.title, freeBookId = null } = {}) {
    const name = String(title ?? '').trim() || 'Imported document';
    if (countWords(res.text) >= BOOK_MIN_WORDS || (res.chapters?.length ?? 0) > 1) {
        const chapters = buildChapters({ text: res.text, chapters: res.chapters });
        if (chapters.length >= 2) {
            return { kind: 'book', item: createBook({ id: newDocumentId('b'), title: name, chapters, freeBookId }) };
        }
    }
    return { kind: 'passage', item: { id: newDocumentId('custom'), title: name, text: res.text, questions: [] } };
}

/** Reads a file and returns { kind, item, stats }; throws a readable error. */
export async function importDocumentFile(file, { title, freeBookId, ...options } = {}) {
    const res = await extractText(file, options);
    return { ...documentFromExtract(res, { title: title ?? res.title, freeBookId }), stats: res.stats ?? null };
}
