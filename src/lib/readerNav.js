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
