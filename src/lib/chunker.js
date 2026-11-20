// Phrase-aware grouping for multi-word RSVP flashes.
//
// Cutting text into fixed slices of N words splits phrases ("of the" / "old
// house"), runs groups across sentence ends ("ended. The") and glues headings
// onto the first sentence. Reading 3-5 words at a glance works when each flash
// is a unit of meaning, so groups here follow the text's own structure:
//
//   - never across a sentence end, a paragraph break or a heading line;
//   - preferably at clause punctuation and before conjunctions/prepositions;
//   - never ending on a word that leans on the next one ("the", "of", "Mr.");
//   - balanced within a sentence (6 words with a max of 5 is 3+3, not 5+1);
//   - shorter when the words are long, so a flash stays readable at a glance.
//
// Token indices match `text.trim().split(/\s+/)`, which is how the Reader
// splits words, so progress, bookmarks and the honest word count are unchanged.

import { rankOf } from './vocab';

/** Words that should not end a group: they belong with what follows. */
const LEANS_FORWARD = new Set((
    'a an the this that these those my your his her its our their whose ' +
    'of to in on at by for with from into onto upon over under about after before between through during ' +
    'without within against among toward towards across along around behind beyond near past since until via per ' +
    'and or but nor so yet if as than because although though while whereas unless ' +
    'do does did will would shall should can could may might must ' +
    'not no very more most less least such some any each every all both either neither ' +
    'mr. mrs. ms. dr. prof. st. mt. sir lord lady saint ' +
    'i we you he she it they who which what when where how why whom'
).split(' '));

/** Starting a group with one of these reads naturally, so a break before it is cheap. */
const STARTS_PHRASE = new Set((
    'and or but nor so yet because although though while whereas unless if when where which who whom whose that ' +
    'to in on at by for with from into onto upon over under about after before between through during ' +
    'without within against among toward towards across along around behind beyond since until'
).split(' '));

/** Abbreviations whose full stop does not end a sentence. */
const ABBREVIATIONS = new Set((
    'mr mrs ms dr prof sr jr st mt vs e.g i.e cf approx dept ' +
    'jan feb apr jun jul aug sep sept oct nov dec corp'
).split(' '));
/** Also ordinary words ("the answer was no."), so only abbreviations before a number: "No. 5", "fig. 3". */
const NUMBERED_ABBREVIATIONS = new Set('no vol fig pp ch sec'.split(' '));

// A footnote mark may follow the punctuation ("mostly.¹").
const SENTENCE_END_RE = /[.!?…]["'”’)\]»]*[⁰¹²³⁴⁵⁶⁷⁸⁹]*$/;
const CLAUSE_END_RE = /[,;:—–]["'”’)\]»]*[⁰¹²³⁴⁵⁶⁷⁸⁹]*$|\.\.\.$|^-{1,2}$/;
const PUNCT_ONLY_RE = /^[^\p{L}\p{N}]+$/u;

const bare = (token) => token.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.]+$/gu, '');

export function endsSentence(token, next = '') {
    if (!SENTENCE_END_RE.test(token)) return false;
    const core = bare(token).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+$/, '').replace(/\.+$/, '');
    // A full stop left on its own by pasted text ("decades .") still ends the sentence.
    if (!core) return true;
    // "J." and "U.S." are initials; "Mr." and "e.g." are abbreviations.
    if (/^\p{L}$/u.test(core) || /^(\p{L}\.)+\p{L}$/u.test(core)) return false;
    if (/[!?]/.test(token)) return true;
    if (ABBREVIATIONS.has(core)) return false;
    if (NUMBERED_ABBREVIATIONS.has(core) && /^\d/.test(next)) return false;
    return true;
}

/**
 * Splits text into the Reader's tokens, noting what whitespace follows each:
 * 2 = paragraph break, 1 = line break, 0 = space.
 */
export function tokenize(text) {
    const tokens = [];
    const re = /\S+/g;
    const src = String(text ?? '').trim();
    let m;
    while ((m = re.exec(src)) !== null) {
        const after = src.slice(m.index + m[0].length).match(/^\s*/)[0];
        const newlines = (after.match(/\n/g) || []).length;
        tokens.push({ word: m[0], gap: newlines >= 2 ? 2 : newlines });
    }
    return tokens;
}

/**
 * Indices after which a group must end: sentence ends, paragraph breaks, and
 * line breaks after a short unpunctuated line (a heading or list item; long
 * lines are just wrapped prose, as PDF text often is).
 */
function hardBreaks(tokens) {
    const hard = new Array(tokens.length).fill(false);
    let lineStart = 0;
    for (let i = 0; i < tokens.length; i++) {
        const { word, gap } = tokens[i];
        // ". . ." spaced out is one ellipsis, not three sentence ends.
        const inEllipsis = PUNCT_ONLY_RE.test(word) && PUNCT_ONLY_RE.test(tokens[i + 1]?.word ?? 'x');
        if ((endsSentence(word, tokens[i + 1]?.word) && !inEllipsis) || gap === 2) hard[i] = true;
        if (gap >= 1) {
            const lineLen = i - lineStart + 1;
            // Narrow PDF columns wrap every few words, so a short line only counts
            // as a heading when the next line starts afresh with a capital or digit.
            const next = tokens[i + 1]?.word ?? '';
            if (gap === 1 && lineLen <= 8 && !/[,;:\-–—]$/.test(word) && /^[^\p{L}\p{N}]*[\p{Lu}\p{N}]/u.test(next)) hard[i] = true;
            lineStart = i + 1;
        }
    }
    if (tokens.length) hard[tokens.length - 1] = true;
    return hard;
}

/**
 * Groups the text's words for RSVP.
 * Returns [{ start, end }] covering every word in order (end exclusive).
 *
 * @param {string} text the passage text
 * @param {{ maxWords?: number, minWords?: number, smart?: boolean }} options
 */
export function buildChunks(text, { maxWords = 1, minWords, smart = true } = {}) {
    const tokens = tokenize(text);
    const max = Math.max(1, Math.min(8, Math.round(maxWords)));
    const chunks = [];
    if (!tokens.length) return chunks;
    if (max === 1 || !smart) {
        for (let i = 0; i < tokens.length; i += max) chunks.push({ start: i, end: Math.min(tokens.length, i + max) });
        return chunks;
    }

    // At 3 per flash a lone word is as unwanted as at 5; the floor is 2 from 3 up.
    const min = Math.max(1, Math.min(max, minWords ?? (max === 3 ? 2 : max - 2)));
    const target = (min + max) / 2;
    // Long words take longer to take in, so the character budget caps a group
    // before the word count does. ~6.5 characters per word is ordinary prose.
    const maxChars = Math.round(max * 6.5 + 4);
    const hard = hardBreaks(tokens);

    const lens = tokens.map(t => [...t.word].length);
    const isWord = tokens.map(t => !PUNCT_ONLY_RE.test(t.word));
    const isClauseEnd = tokens.map(t => CLAUSE_END_RE.test(t.word));
    const startsSpan = tokens.map(t => /^["“‘(]/.test(t.word));
    const endsSpan = tokens.map(t => /["”’)]$/.test(t.word));
    const insideDelim = new Array(tokens.length).fill(false);
    let parenDepth = 0;
    let inCurlyQuote = false;
    let inStraightQuote = false;
    for (let k = 0; k < tokens.length; k++) {
        const w = tokens[k].word;
        for (const ch of w) {
            if (ch === '(') parenDepth += 1;
            else if (ch === ')' && parenDepth > 0) parenDepth -= 1;
            else if (ch === '“') inCurlyQuote = true;
            else if (ch === '”') inCurlyQuote = false;
            else if (ch === '"') inStraightQuote = !inStraightQuote;
        }
        if (hard[k]) { parenDepth = 0; inCurlyQuote = false; inStraightQuote = false; }
        insideDelim[k] = parenDepth > 0 || inCurlyQuote || inStraightQuote;
    }

    /** Cost of a group covering tokens [i, j). Lower is better. */
    const groupCost = (i, j, segEnd) => {
        let words = 0;
        let chars = -1;
        let innerClauses = 0;
        for (let k = i; k < j; k++) {
            if (isWord[k]) words += 1;
            chars += lens[k] + 1;
            if (k < j - 1 && isClauseEnd[k]) innerClauses += 1;
        }
        if (words > max) return Infinity;
        let cost = 0.6 * (words - target) ** 2;
        // A comma inside a flash means reading two half-thoughts at once.
        cost += innerClauses * 5;
        if (chars > maxChars) cost += (chars - maxChars) * 1.5;
        if (j < segEnd) {
            const last = tokens[j - 1].word;
            const next = tokens[j].word;
            const clause = CLAUSE_END_RE.test(last);
            // Short groups only where the sentence forces them or a comma invites them.
            if (words < min) cost += (min - words) * (clause ? 1.5 : 3);
            if (clause) cost -= 4.5;
            else if (tokens[j - 1].gap === 1) cost -= 1.5;
            if (LEANS_FORWARD.has(bare(last)) && !clause) cost += 6;
            if (STARTS_PHRASE.has(bare(next))) cost -= 2.5;
            // "of" binds to the word before it: "the end | of the road" splits a noun phrase.
            else if (bare(next) === 'of') cost += 3;
            // A lone dash or quote mark belongs with a neighbour, never alone at an edge.
            if (!isWord[j]) cost += 3;
            if (!isWord[j - 1] && !CLAUSE_END_RE.test(last)) cost += 3;
            // Keep short dialogue quotes and parenthetical asides grouped together.
            if (insideDelim[j - 1]) cost += 4.5;
            if (startsSpan[j] || endsSpan[j - 1]) cost -= 1.5;
        }
        return cost;
    };

    let segStart = 0;
    for (let s = 0; s < tokens.length; s++) {
        if (!hard[s]) continue;
        const segEnd = s + 1;
        // Shortest-path over break positions within the sentence.
        const n = segEnd - segStart;
        const best = new Array(n + 1).fill(Infinity);
        const from = new Array(n + 1).fill(-1);
        best[0] = 0;
        for (let a = 0; a < n; a++) {
            if (best[a] === Infinity) continue;
            // Allow a few punctuation-only tokens beyond max words.
            for (let b = a + 1; b <= Math.min(n, a + max + 3); b++) {
                let c = groupCost(segStart + a, segStart + b, segEnd);
                // A single overlong token must still be placeable.
                if (c === Infinity && b === a + 1) c = 50;
                if (c === Infinity) break;
                if (best[a] + c < best[b]) { best[b] = best[a] + c; from[b] = a; }
            }
        }
        const cuts = [];
        for (let b = n; b > 0; b = from[b]) cuts.push(b);
        let prev = 0;
        for (const b of cuts.reverse()) {
            chunks.push({ start: segStart + prev, end: segStart + b });
            prev = b;
        }
        segStart = segEnd;
    }
    return chunks;
}

/** Index of the chunk containing word `index` (binary search over starts). */
export function chunkIndexAt(chunks, index) {
    let lo = 0;
    let hi = chunks.length - 1;
    if (hi < 0) return -1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (chunks[mid].start <= index) lo = mid; else hi = mid - 1;
    }
    return lo;
}

/**
 * Per-word display weights, averaging 1 over the passage so the flash timing
 * still averages out to the chosen WPM: long words get a little more time,
 * short function words a little less.
 */
export function wordWeights(words, rank = null) {
    if (!words.length) return [];
    const raw = words.map(w => {
        const len = [...w.replace(/[^\p{L}\p{N}]/gu, '')].length;
        if (len === 0) return 0.3;
        const base = Math.min(1.8, Math.max(0.7, 0.55 + len * 0.075));
        // With the frequency list, rare words (and names) get a little more
        // time and everyday words a little less; the mean is still 1.
        if (!rank) return base;
        const core = w.toLowerCase().replace(/[^\p{L}]/gu, '');
        if (core.length < 3) return base;
        const r = rankOf(core, rank);
        return base + (r < 2000 ? 0 : r < 8000 ? 0.12 : r < 20000 ? 0.28 : 0.45);
    });
    const mean = raw.reduce((s, x) => s + x, 0) / raw.length;
    return raw.map(x => x / mean);
}

/**
 * Extra pause after a flash, in units of one word's time: a beat at clause
 * punctuation, more at a sentence end, most at a paragraph break. Scaling by
 * word time keeps the pauses proportionate at 200 and at 1,000 WPM.
 */
export function pauseAfter(token, gap, next = '') {
    if (gap === 2) return 1.6;
    if (endsSentence(token, next)) return 1.0;
    if (CLAUSE_END_RE.test(token)) return 0.45;
    if (gap === 1) return 0.3;
    return 0;
}

/**
 * Joins a flash's words for display, closing up punctuation that pasted or
 * extracted text left as a separate word ("decades ." / "( this )").
 */
export const joinFlashWords = (list) => list.reduce((out, w, i) => {
    if (i === 0) return w;
    const closes = /^[,.;:!?)\]}”’»…%]+$/.test(w);
    const opens = /[([{“‘«]$/.test(list[i - 1]) && list[i - 1].length === 1;
    return out + (closes || opens ? '' : ' ') + w;
}, '');
