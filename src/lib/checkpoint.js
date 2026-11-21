// Measurement while you read: quick fill-the-blank checkpoints, the group-size
// staircase they drive, the live speed trace, and the difficulty map.
//
// Checkpoints need no AI. A sentence you have just read comes back with one
// content word blanked out and four choices, all words from the same stretch
// of text, so the only way to know the answer is to have taken the sentence in.

import { endsSentence } from './chunker';
import { isFunctionWord } from './textColor';
import { rankOf } from './vocab';

const coreOf = (w) => String(w ?? '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
const isPlainWord = (c) => /^\p{Ll}{4,}$/u.test(c);

function shuffled(list, random) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** Whole sentences inside words[from, to), as [{ start, end }], 6-40 words long. */
export function sentencesIn(words, from, to) {
    const out = [];
    let s = Math.max(0, from);
    if (s > 0) while (s < to && !endsSentence(words[s - 1], words[s])) s += 1;
    for (let i = s; i < to; i++) {
        if (endsSentence(words[i], words[i + 1])) {
            const len = i + 1 - s;
            if (len >= 6 && len <= 40) out.push({ start: s, end: i + 1 });
            s = i + 1;
        }
    }
    return out;
}

/**
 * Builds one fill-the-blank question from the stretch words[from, to) just
 * read. The blank is a content word (rarer words preferred: they carry the
 * meaning); the three other choices are content words of similar length from
 * the same stretch but not from that sentence, so none can be spotted on screen.
 * Returns { sentence, options, answerIndex, answer, wordIndex } or null.
 */
export function buildCloze(words, from, to, { rank = null, random = Math.random } = {}) {
    const end = Math.min(words.length, to);
    const sentences = shuffled(sentencesIn(words, from, end).slice(-3), random);
    if (!sentences.length) return null;

    const stretch = [];
    for (let i = Math.max(0, from); i < end; i++) {
        const c = coreOf(words[i]);
        if (isPlainWord(c) && !isFunctionWord(c)) stretch.push({ i, c });
    }

    for (const s of sentences) {
        const candidates = [];
        for (let i = s.start; i < s.end; i++) {
            const c = coreOf(words[i]);
            if (isPlainWord(c) && !isFunctionWord(c)) candidates.push({ i, c, r: rank ? Math.min(25000, rankOf(c, rank)) : c.length * 100 });
        }
        if (!candidates.length) continue;
        candidates.sort((a, b) => b.r - a.r);
        const target = candidates[Math.floor(random() * Math.min(3, candidates.length))];

        const inSentence = new Set(words.slice(s.start, s.end).map(w => coreOf(w).toLowerCase()));
        const seen = new Set([target.c]);
        const pool = [];
        for (const { c } of shuffled(stretch, random)) {
            if (seen.has(c) || inSentence.has(c)) continue;
            if (Math.abs(c.length - target.c.length) > 3) continue;
            // Near-twins ("river" / "rivers") would make the choice a trick.
            if (c.slice(0, 4) === target.c.slice(0, 4)) continue;
            seen.add(c);
            pool.push(c);
            if (pool.length === 3) break;
        }
        if (pool.length < 3) continue;

        const sentence = words.slice(s.start, s.end)
            .map((w, k) => (s.start + k === target.i ? w.replace(target.c, '_____') : w))
            .join(' ');
        const options = shuffled([target.c, ...pool], random);
        return { sentence, options, answerIndex: options.indexOf(target.c), answer: target.c, wordIndex: target.i };
    }
    return null;
}

/**
 * The words-per-flash staircase. Four right in a row at the current size steps
 * up one; two misses in the last three steps down one. `log` is the recent
 * checkpoint history, newest last, as [{ ok, size }].
 */
export function nextChunkSize(log, current, { min = 2, max = 5 } = {}) {
    const atSize = (log ?? []).filter(e => e.size === current);
    const lastFour = atSize.slice(-4);
    if (lastFour.length === 4 && lastFour.every(e => e.ok) && current < max) return current + 1;
    const lastThree = atSize.slice(-3);
    if (lastThree.filter(e => !e.ok).length >= 2 && current > min) return current - 1;
    return current;
}

/** Faster than this between two one-second samples is a jump, not reading. */
const MAX_READ_WPM = 3600;

/**
 * Turns per-second samples [{ t, idx, slow }] into speed buckets
 * [{ t, wpm, slow }]. Seconds that jumped forward faster than anyone reads
 * (a scrub or skip) and backward steps are left out of the speed. `rewinds`
 * are the times you went back yourself, passed through for the chart.
 */
export function speedTrace(samples, bucketSec = 10, rewinds = []) {
    const buckets = [];
    let current = null;
    for (let k = 1; k < samples.length; k++) {
        const a = samples[k - 1];
        const b = samples[k];
        const dt = b.t - a.t;
        if (dt <= 0) continue;
        const moved = b.idx - a.idx;
        if (moved < 0 || moved / (dt / 60) > MAX_READ_WPM) continue;
        const n = Math.floor(b.t / bucketSec);
        if (!current || current.n !== n) {
            current = { n, words: 0, secs: 0, slow: false };
            buckets.push(current);
        }
        current.words += moved;
        current.secs += dt;
        current.slow ||= Boolean(b.slow);
    }
    return {
        buckets: buckets.map(b => ({ t: b.n * bucketSec, wpm: Math.round(b.words / (b.secs / 60)), slow: b.slow })),
        rewinds: [...rewinds]
    };
}

/**
 * How hard each word is to read, 0..1: mostly how rare it is (by the
 * frequency list, or length without one), partly how long its sentence runs.
 */
export function difficultyScores(words, rank = null) {
    const scores = new Array(words.length).fill(0);
    let start = 0;
    for (let i = 0; i < words.length; i++) {
        if (!endsSentence(words[i], words[i + 1]) && i < words.length - 1) continue;
        const sentLen = Math.min(1, (i + 1 - start) / 35);
        for (let k = start; k <= i; k++) {
            const c = coreOf(words[k]).toLowerCase();
            let rare = 0;
            if (/^\p{L}{3,}$/u.test(c)) {
                if (rank) {
                    const r = rankOf(c, rank);
                    rare = r < 2000 ? 0 : r < 8000 ? 0.35 : r < 20000 ? 0.7 : 1;
                } else {
                    rare = c.length >= 9 ? 0.6 : 0;
                }
            }
            scores[k] = 0.65 * rare + 0.35 * sentLen;
        }
        start = i + 1;
    }
    return scores;
}

/** Averages scores into `n` buckets and stretches them to 0..1 (relative to this text). */
export function difficultyBuckets(scores, n = 60) {
    if (!scores.length) return [];
    const count = Math.min(n, scores.length);
    const raw = Array.from({ length: count }, (_, b) => {
        const from = Math.floor((b * scores.length) / count);
        const to = Math.max(from + 1, Math.floor(((b + 1) * scores.length) / count));
        let sum = 0;
        for (let i = from; i < to; i++) sum += scores[i];
        return sum / (to - from);
    });
    const lo = Math.min(...raw);
    const hi = Math.max(...raw);
    return raw.map(v => (hi - lo < 1e-6 ? 0 : (v - lo) / (hi - lo)));
}
