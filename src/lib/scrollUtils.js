/**
 * Pure helpers for ScrollText and RSVP layout/formatting.
 */

/**
 * Groups measured word vertical centers into shared visual-line centers so
 * line-by-line scroll motion steps cleanly once per visual line with zero
 * sub-pixel jitter between words on the same line.
 */
export function groupLineTops(tops, tolerancePx = 6) {
    if (!Array.isArray(tops) || tops.length === 0) return [];
    const lineTops = new Array(tops.length);
    let lineSum = tops[0];
    let lineCount = 1;
    let lineStart = 0;

    for (let i = 1; i < tops.length; i++) {
        const y = tops[i];
        const avg = lineSum / lineCount;
        if (Math.abs(y - avg) <= tolerancePx) {
            lineSum += y;
            lineCount += 1;
        } else {
            const center = lineSum / lineCount;
            for (let k = lineStart; k < i; k++) lineTops[k] = center;
            lineStart = i;
            lineSum = y;
            lineCount = 1;
        }
    }
    const lastCenter = lineSum / lineCount;
    for (let k = lineStart; k < tops.length; k++) lineTops[k] = lastCenter;
    return lineTops;
}

/**
 * Heuristic for standalone section/chapter headings in a paragraph list.
 */
export function isHeadingParagraph(words) {
    if (!Array.isArray(words) || words.length === 0 || words.length > 10) return false;
    const text = words.map(w => (typeof w === 'string' ? w : w.word)).join(' ').trim();
    if (!text) return false;
    if (/[.!?…,;]$/.test(text)) return false;
    if (/^(?:chapter|part|book|section|prologue|epilogue|introduction|preface|foreword|afterword|appendix|law)\b/i.test(text)) return true;
    const letters = text.replace(/[^a-zA-Z]/g, '');
    if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
    return words.length <= 6 && /^[A-Z0-9"“‘(]/.test(text);
}

/**
 * Auto-scale multiplier for long single words in RSVP so they fit comfortably
 * without horizontal clipping.
 */
export function rsvpWordScale(word) {
    const len = String(word ?? '').length;
    if (len <= 11) return 1;
    return Math.max(0.58, Number((11 / len).toFixed(3)));
}
