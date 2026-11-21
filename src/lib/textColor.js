// Colouring for the Scroll reader (and any surface that lays out real lines).
//
// The colour is there to carry information to the eye, not to decorate:
//
//   - Line gradient: the colour flows letter by letter across each line, and
//     each line starts in the colour the previous one ended in. At the end of a
//     line your eye follows the colour to the start of the next, which cuts
//     return-sweep misses (landing on the wrong line). The cycle runs
//     text -> A, A -> text, text -> B, B -> text, so neighbouring lines differ.
//   - Phrases: neighbouring phrase groups alternate colour, so each group
//     reads as one unit, which suits taking in 3-5 words per fixation.
//   - Sentences: alternate tint per sentence, so you see where one ends.
//   - Faded function words: "the", "of", "and" are fainter, so the eye lands
//     on content words, which carry the meaning.
//
// Colours are mixed with the page's text colour (`var(--reading-fg)`) rather
// than used raw, so every scheme keeps its contrast on every page theme.

import { buildChunks, endsSentence } from './chunker';

export const SCROLL_COLOR_MODES = [
    { id: 'none', label: 'Plain', note: 'One text colour' },
    { id: 'gradient', label: 'Line gradient', note: 'Colour flows across each line and into the next, guiding your eye back to the start of the next line' },
    { id: 'phrases', label: 'Phrases', note: 'Neighbouring phrase groups alternate colour, one unit per glance' },
    { id: 'sentences', label: 'Sentences', note: 'Each sentence alternates colour, so endings stand out' }
];

export const SCROLL_PALETTES = [
    { id: 'classic', label: 'Blue / red', a: '#3b82f6', b: '#ef4444' },
    { id: 'ocean', label: 'Teal / violet', a: '#14b8a6', b: '#a855f7' },
    { id: 'ember', label: 'Amber / rose', a: '#f59e0b', b: '#f43f5e' },
    { id: 'forest', label: 'Green / sky', a: '#22c55e', b: '#0ea5e9' },
    { id: 'mono', label: 'Grey', a: '#94a3b8', b: '#64748b' }
];

/** Small grammatical words; fading them lets the eye land on content words. */
const FUNCTION_WORDS = new Set((
    'a an the of to in on at by for with from into onto upon as than ' +
    'and or but nor so yet if that this these those its it ' +
    'is are was were be been being am has have had do does did ' +
    'will would shall should can could may might must not'
).split(' '));

export const isFunctionWord = (word) =>
    FUNCTION_WORDS.has(String(word).toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''));

/** `pct`% of `color` mixed into the page text colour. */
export const tint = (color, pct) =>
    `color-mix(in oklab, ${color} ${Math.round(pct)}%, var(--reading-fg))`;

/** Mix between two CSS colours, `t` in 0..1 (0 = from, 1 = to). */
const between = (from, to, t) => {
    const p = Math.round(Math.max(0, Math.min(1, t)) * 100);
    if (p === 0) return from;
    if (p === 100) return to;
    return `color-mix(in oklab, ${to} ${p}%, ${from})`;
};

const paletteFor = (id) => SCROLL_PALETTES.find(p => p.id === id) ?? SCROLL_PALETTES[0];

/** The four anchor colours a line gradient cycles through. */
export function gradientAnchors(paletteId, strength = 0.7) {
    const pal = paletteFor(paletteId);
    const pct = Math.max(0, Math.min(1, strength)) * 100;
    return ['var(--reading-fg)', tint(pal.a, pct), 'var(--reading-fg)', tint(pal.b, pct)];
}

/**
 * Groups measured word boxes into visual lines.
 * `boxes[i]` is { top, left, right } relative to the text column, or null.
 * Returns per word { line, x0, x1 } with x as a fraction of `width` (0..1).
 */
export function layoutLines(boxes, width) {
    const out = new Array(boxes.length).fill(null);
    const w = Math.max(1, width);
    let line = -1;
    let lineTop = -Infinity;
    for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (!b) continue;
        // A new line starts when the box sits clearly below the last line.
        if (b.top > lineTop + 2) { line += 1; lineTop = b.top; }
        out[i] = {
            line,
            x0: Math.max(0, Math.min(1, b.left / w)),
            x1: Math.max(0, Math.min(1, b.right / w))
        };
    }
    return out;
}

/** CSS background for one word under the line gradient. */
export function gradientBackground(pos, anchors) {
    const from = anchors[pos.line % 4];
    const to = anchors[(pos.line + 1) % 4];
    return `linear-gradient(90deg, ${between(from, to, pos.x0)}, ${between(from, to, pos.x1)})`;
}

/**
 * Per-word looks that come from the text alone (no layout): alternating
 * phrase or sentence colours and faded function words.
 * Returns an array of { color?, fade? } indexed like `text.trim().split(/\s+/)`.
 */
export function textLooks(text, { mode = 'none', paletteId = 'classic', strength = 0.7, fadeFunctionWords = false, phraseWords = 4 } = {}) {
    const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
    const looks = words.map(w => ({ fade: fadeFunctionWords && isFunctionWord(w) }));
    if (mode === 'phrases' || mode === 'sentences') {
        const pal = paletteFor(paletteId);
        const pct = Math.max(0, Math.min(1, strength)) * 100;
        const colors = [tint(pal.a, pct), tint(pal.b, pct)];
        if (mode === 'phrases') {
            buildChunks(text, { maxWords: phraseWords }).forEach((c, k) => {
                for (let i = c.start; i < c.end; i++) looks[i].color = colors[k % 2];
            });
        } else {
            let k = 0;
            for (let i = 0; i < words.length; i++) {
                looks[i].color = colors[k % 2];
                if (endsSentence(words[i], words[i + 1])) k += 1;
            }
        }
    }
    return looks;
}

/**
 * Time each word takes under smart pacing, in units of one word at the set
 * WPM, averaging 1 over the passage: long words and punctuation get more,
 * short words less, and the overall speed stays what you chose.
 */
export function pacingCosts(words, weights, pauses) {
    if (!words.length) return [];
    const raw = words.map((_, i) => (weights[i] ?? 1) + (pauses[i] ?? 0));
    const mean = raw.reduce((s, x) => s + x, 0) / raw.length;
    return raw.map(x => x / mean);
}

/**
 * Advances a reading position by `budget` word-units given per-word costs.
 * Returns the new position (fractional, capped at costs.length).
 */
export function advanceByCost(position, budget, costs) {
    let p = position;
    let left = budget;
    const n = costs.length;
    while (left > 0 && p < n) {
        const i = Math.floor(p);
        const cost = Math.max(0.05, costs[i] ?? 1);
        const need = (i + 1 - p) * cost;
        if (left >= need) { p = i + 1; left -= need; } else { p += left / cost; left = 0; }
    }
    return Math.min(n, p);
}

/**
 * Eases smart-pacing costs ahead of hard stretches: each word's cost grows
 * with how difficult the next `window` words are, so the scroll slows a little
 * before a dense passage rather than in the middle of it. The mean stays 1,
 * so the average speed is unchanged.
 */
export function easeCosts(costs, scores, { window = 30, strength = 0.3 } = {}) {
    if (!costs?.length || scores?.length !== costs.length) return costs;
    const n = costs.length;
    // Sliding mean of the difficulty just ahead of each word.
    const ahead = new Array(n);
    let sum = 0;
    for (let i = n - 1; i >= 0; i--) {
        sum += scores[i];
        if (i + window < n) sum -= scores[i + window];
        ahead[i] = sum / Math.min(window, n - i);
    }
    // A loop rather than Math.min(...ahead): spreading 100k+ values overflows the stack.
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of ahead) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = hi - lo || 1;
    const eased = costs.map((c, i) => c * (1 + strength * ((ahead[i] - lo) / span - 0.5)));
    const mean = eased.reduce((s, x) => s + x, 0) / n;
    return eased.map(x => x / mean);
}
