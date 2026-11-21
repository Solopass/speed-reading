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
 * Builds per-word line span metadata ({ lineStart, lineLen, nextLineTop }) from
 * grouped lineTops so smooth scroll interpolates continuously across every word
 * on a line instead of freezing until the last word and lurching to the next line.
 */
export function buildLineSpans(lineTops) {
    const n = Array.isArray(lineTops) ? lineTops.length : 0;
    const lineStart = new Array(n);
    const lineLen = new Array(n);
    const nextLineTop = new Array(n);
    let i = 0;
    while (i < n) {
        const y = lineTops[i];
        let j = i + 1;
        while (j < n && lineTops[j] === y) j += 1;
        const len = j - i;
        const nextY = j < n ? lineTops[j] : y;
        for (let k = i; k < j; k++) {
            lineStart[k] = i;
            lineLen[k] = len;
            nextLineTop[k] = nextY;
        }
        i = j;
    }
    return { lineStart, lineLen, nextLineTop };
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

/**
 * Optimal Recognition Point character index inside a word (skipping leading
 * quotes/brackets so "Hello" pivots on the word itself).
 */
export function orpIndex(word) {
    const str = String(word ?? '');
    if (!str) return 0;
    const lead = str.match(/^[^\p{L}\p{N}]*/u)[0].length;
    const coreLen = [...str.slice(lead).replace(/[^\p{L}\p{N}]+$/u, '')].length;
    const orp = coreLen <= 1 ? 0 : coreLen <= 5 ? 1 : coreLen <= 9 ? 2 : coreLen <= 13 ? 3 : 4;
    return Math.min(str.length - 1, lead + orp);
}

/**
 * Character span [start, end) around the ORP center for 'single' vs 'cluster'
 * (3-letter anchor cluster) highlight modes.
 */
export function focalRange(word, spanMode = 'single') {
    const str = String(word ?? '');
    const center = orpIndex(str);
    if (spanMode !== 'cluster' || str.length <= 1) {
        return { start: center, center, end: Math.min(str.length, center + 1) };
    }
    const start = Math.max(0, center - 1);
    const end = Math.min(str.length, center + 2);
    return { start, center, end };
}

/**
 * Finds the word index whose visual line center is closest to `y` for
 * constant-pixel-velocity scrolling.
 */
export function wordIndexAtY(lineTops, y) {
    const n = Array.isArray(lineTops) ? lineTops.length : 0;
    if (n === 0) return 0;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (lineTops[mid] < y) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/**
 * Searches word-split text for a phrase/keyword and returns matching word indices
 * with short surrounding snippets for in-reader Jump-to-match.
 */
export function searchTextMatches(text, query, maxResults = 30) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q || !text) return [];
    const words = String(text).trim().split(/\s+/).filter(Boolean);
    const qWords = q.split(/\s+/).filter(Boolean);
    if (qWords.length === 0) return [];
    const matches = [];
    for (let i = 0; i < words.length && matches.length < maxResults; i++) {
        let hit = false;
        if (qWords.length === 1) {
            hit = words[i].toLowerCase().includes(qWords[0]);
        } else if (i + qWords.length <= words.length) {
            hit = qWords.every((qw, k) => {
                const w = words[i + k].toLowerCase();
                return k === 0 ? w.endsWith(qw) || w.includes(qw) : k === qWords.length - 1 ? w.startsWith(qw) || w.includes(qw) : w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') === qw || w === qw;
            });
        }
        if (hit) {
            const from = Math.max(0, i - 4);
            const to = Math.min(words.length, i + qWords.length + 6);
            matches.push({
                index: i,
                snippet: `${from > 0 ? '…' : ''}${words.slice(from, to).join(' ')}${to < words.length ? '…' : ''}`
            });
        }
    }
    return matches;
}
