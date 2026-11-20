// Word counting that survives jumping around a passage.
//
// The recorded speed is words covered ÷ time spent. Rewinding to re-read a
// sentence or skipping ahead must not inflate or deflate that, so the count is
// banked at every jump: words covered before the jump are kept, and counting
// restarts from wherever you land. Re-reading a stretch counts it again, which
// is honest: you spent the time reading those words again.

import { isHeading } from './book';

export const startCount = (base = 0) => ({ counted: 0, base });

/** Words covered so far, with the cursor at `at`. */
export const wordsCovered = (count, at) => count.counted + Math.max(0, at - count.base);

/** Bank what was covered up to `from`, then restart counting at `to`. */
export const jump = (count, from, to) => ({ counted: wordsCovered(count, from), base: to });

/** Clamps a target index into the passage. */
export const clampIndex = (index, total) => Math.max(0, Math.min(Math.max(0, total - 1), Math.round(index)));

/** "1:05" for seconds. */
export function clock(secs) {
    const s = Math.max(0, Math.round(secs));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Where word `index` of `oldText` is in `newText`, after an edit such as AI
 * Clean removing paragraphs. Finds the same run of words near the expected
 * spot; shorter runs are tried if the exact one is gone, and a proportional
 * position is the last resort. Without this, a saved place or bookmark kept
 * its old number and pointed at whatever word moved into that slot.
 */
export function remapWordIndex(oldText, newText, index) {
    const oldWords = String(oldText ?? '').trim().split(/\s+/).filter(Boolean);
    const newWords = String(newText ?? '').trim().split(/\s+/).filter(Boolean);
    if (!newWords.length) return 0;
    const at = Math.max(0, Math.min(oldWords.length - 1, index));
    if (oldText === newText) return Math.min(index, newWords.length);
    const guess = oldWords.length ? Math.round((at / oldWords.length) * newWords.length) : 0;

    for (const span of [8, 5, 3]) {
        const needle = oldWords.slice(at, at + span);
        if (needle.length < Math.min(span, 3)) continue;
        let best = -1;
        for (let i = 0; i + needle.length <= newWords.length; i++) {
            let match = true;
            for (let k = 0; k < needle.length; k++) {
                if (newWords[i + k] !== needle[k]) { match = false; break; }
            }
            if (match && (best === -1 || Math.abs(i - guess) < Math.abs(best - guess))) best = i;
        }
        if (best !== -1) return best;
    }
    return Math.max(0, Math.min(newWords.length - 1, guess));
}

/**
 * Extracts navigable timeline sections for any text: uses detected chapter/section
 * headings when present, or evenly spaced parts for long unheaded documents.
 */
export function extractSections(text) {
    if (!text || !text.trim()) return [];
    const paragraphs = text.trim().split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const headings = [];
    let offset = 0;

    for (const p of paragraphs) {
        const count = p.split(/\s+/).filter(Boolean).length;
        if (isHeading(p)) {
            headings.push({ title: p.replace(/^#+\s*/, '').trim(), index: offset });
        }
        offset += count;
    }

    if (headings.length >= 2 || (headings.length === 1 && headings[0].index > 0)) {
        if (headings[0].index > 0) headings.unshift({ title: 'Opening', index: 0 });
        return headings;
    }

    if (offset < 200) return [];
    const parts = Math.min(8, Math.max(3, Math.round(offset / 400)));
    const step = Math.floor(offset / parts);
    return Array.from({ length: parts }, (_, i) => ({
        title: `Part ${i + 1}`,
        index: i * step
    }));
}
