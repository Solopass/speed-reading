// Drill packs: practice material for the Neuro-Drills taken from your own
// reading, so the phrases you learn to take in at a glance and the terms you
// scan for come from the books you are working through.
//
// A pack is plain data (no functions, no library data), small enough to share:
//   { kind: 'drill-pack', version, id, title, source, createdAt,
//     phrases: { [n]: ['n-word phrase', ...] }, wordBank: [...], terms: [...], passages: [...] }
// Phase 2 builds packs without AI; AI-written drills add to the same shape later.

import { endsSentence } from './chunker';
import { isFunctionWord } from './textColor';
import { rankOf } from './vocab';

export const PACK_VERSION = 1;
export const PHRASE_SIZES = [1, 2, 3, 4, 5, 6, 7];
const PHRASES_PER_SIZE = 40;
const MAX_TERMS = 40;
const MAX_PASSAGES = 8;

const core = (w) => String(w ?? '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

function shuffled(list, random) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** Sentences as arrays of clean words (punctuation trimmed), 3+ words long. */
function sentences(text) {
    const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
    const out = [];
    let cur = [];
    words.forEach((w, i) => {
        const c = core(w);
        if (c) cur.push(c);
        if (endsSentence(w, words[i + 1])) {
            if (cur.length >= 3) out.push(cur);
            cur = [];
        }
    });
    if (cur.length >= 3) out.push(cur);
    return out;
}

/**
 * Real phrases of each length, taken from inside sentences (never across a
 * full stop) and never starting or ending on a word like "the" or "of",
 * so each one reads as a unit.
 */
export function extractPhrases(text, { perSize = PHRASES_PER_SIZE, random = Math.random } = {}) {
    const sents = sentences(text);
    const out = {};
    for (const n of PHRASE_SIZES) {
        const seen = new Set();
        const found = [];
        for (const s of shuffled(sents, random)) {
            if (s.length < n) continue;
            // A couple of start points per sentence keeps the set varied.
            const starts = shuffled(Array.from({ length: s.length - n + 1 }, (_, i) => i), random).slice(0, 2);
            for (const st of starts) {
                const ws = s.slice(st, st + n);
                if (n > 1 && (isFunctionWord(ws[0]) && isFunctionWord(ws[1]))) continue;
                if (n > 1 && isFunctionWord(ws[n - 1])) continue;
                if (n === 1 && (ws[0].length < 4 || isFunctionWord(ws[0]))) continue;
                const phrase = ws.join(' ');
                const key = phrase.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                found.push(phrase);
                if (found.length >= perSize) break;
            }
            if (found.length >= perSize) break;
        }
        out[n] = found;
    }
    return out;
}

/** Content words of 4-10 letters, for decoy options; distinct, lower case. */
export function extractWordBank(text, limit = 200) {
    const seen = new Set();
    for (const w of String(text ?? '').split(/\s+/)) {
        const c = core(w).toLowerCase();
        if (/^\p{L}{4,10}$/u.test(c) && !isFunctionWord(c)) seen.add(c);
        if (seen.size >= limit) break;
    }
    return [...seen];
}

/**
 * The document's key terms: words used at least twice that are not everyday
 * words (by the frequency list when it is available, by length otherwise),
 * most used first.
 */
export function extractTerms(text, rank = null, limit = MAX_TERMS) {
    const counts = new Map();
    for (const w of String(text ?? '').split(/\s+/)) {
        const c = core(w);
        if (!/^\p{L}{5,}$/u.test(c)) continue;
        const lower = c.toLowerCase();
        if (isFunctionWord(lower)) continue;
        counts.set(lower, (counts.get(lower) ?? 0) + 1);
    }
    const uncommon = (w) => (rank ? rankOf(w, rank) >= 3000 : w.length >= 8);
    return [...counts.entries()]
        .filter(([w, n]) => n >= 2 && uncommon(w))
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
        .slice(0, limit)
        .map(([w]) => w);
}

/** Paragraphs of 60-160 words to scan, spread across the text. */
export function extractPassages(text, limit = MAX_PASSAGES) {
    const paras = String(text ?? '').split(/\n\s*\n/).map(p => p.trim().replace(/\s+/g, ' ')).filter(p => {
        const n = p.split(' ').length;
        return n >= 60 && n <= 160;
    });
    if (paras.length <= limit) return paras;
    const step = paras.length / limit;
    return Array.from({ length: limit }, (_, i) => paras[Math.floor(i * step)]);
}

/** Builds a pack from a text. Throws when the text is too short to drill on. */
export function buildDrillPack({ title, text, source = {}, rank = null, random = Math.random, now = new Date() }) {
    const phrases = extractPhrases(text, { random });
    const passages = extractPassages(text);
    const total = Object.values(phrases).reduce((n, list) => n + list.length, 0);
    if (total < 20) throw new Error('That text is too short to make a drill pack from. Pick something a few hundred words long.');
    return {
        kind: 'drill-pack',
        version: PACK_VERSION,
        id: `pack-${now.getTime()}`,
        title: String(title || 'Drill pack').slice(0, 120),
        source: { title: String(source.title ?? title ?? '').slice(0, 120), ...(source.chapter ? { chapter: String(source.chapter).slice(0, 120) } : {}) },
        createdAt: now.toISOString().slice(0, 10),
        phrases,
        wordBank: extractWordBank(text),
        terms: extractTerms(text, rank),
        passages
    };
}

/**
 * Checks and cleans a pack from storage or from someone else: only the known
 * fields, only strings, capped lengths. Returns null for anything that is not
 * a pack.
 */
export function normalizePack(raw) {
    if (!raw || typeof raw !== 'object' || raw.kind !== 'drill-pack') return null;
    const strings = (list, max, len) => (Array.isArray(list) ? list.filter(s => typeof s === 'string' && s.trim()).map(s => s.slice(0, len)).slice(0, max) : []);
    const phrases = {};
    for (const n of PHRASE_SIZES) {
        phrases[n] = strings(raw.phrases?.[n], PHRASES_PER_SIZE * 2, 120)
            .filter(p => p.trim().split(/\s+/).length === n)
            .slice(0, PHRASES_PER_SIZE);
    }
    const pack = {
        kind: 'drill-pack',
        version: PACK_VERSION,
        id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 60) : `pack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.slice(0, 120) : 'Drill pack',
        source: { title: typeof raw.source?.title === 'string' ? raw.source.title.slice(0, 120) : '', ...(typeof raw.source?.chapter === 'string' ? { chapter: raw.source.chapter.slice(0, 120) } : {}) },
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt.slice(0, 10) : '',
        phrases,
        wordBank: strings(raw.wordBank, 200, 20),
        terms: strings(raw.terms, MAX_TERMS, 40),
        passages: strings(raw.passages, MAX_PASSAGES, 1500)
    };
    const hasContent = Object.values(pack.phrases).some(l => l.length) || pack.passages.length;
    return hasContent ? pack : null;
}

/** A phrase of `n` words from the pack, falling back to the nearest size it has. */
export function pickPhrase(pack, n, random = Math.random) {
    const sizes = [n, ...PHRASE_SIZES.filter(s => s !== n).sort((a, b) => Math.abs(a - n) - Math.abs(b - n))];
    for (const s of sizes) {
        const list = pack?.phrases?.[s];
        if (list?.length) return list[Math.floor(random() * list.length)].split(' ');
    }
    return null;
}

/** A scanning round from the pack: a passage and a word in it to find (a key term when one appears). */
export function pickScanRound(pack, random = Math.random) {
    const passages = pack?.passages ?? [];
    if (!passages.length) return null;
    const text = passages[Math.floor(random() * passages.length)];
    const inText = text.split(/\s+/).map(w => core(w).toLowerCase());
    const terms = (pack.terms ?? []).filter(t => inText.includes(t));
    const long = [...new Set(inText.filter(w => /^\p{L}{7,}$/u.test(w)))];
    const pool = terms.length ? terms : long;
    if (!pool.length) return null;
    return { text, target: pool[Math.floor(random() * pool.length)] };
}
