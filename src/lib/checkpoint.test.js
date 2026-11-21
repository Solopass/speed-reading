import { describe, expect, it } from 'vitest';
import { buildCloze, difficultyBuckets, difficultyScores, nextChunkSize, sentencesIn, speedTrace } from './checkpoint';
import { easeCosts } from './textColor';

const text = 'The farmers planted barley along the river every spring. Heavy floods carried thick silt across the fields. Children gathered smooth pebbles near the wooden bridge. Merchants traded copper bowls for woven baskets at market. Nobody expected the harvest to fail that year.';
const words = text.split(' ');
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

describe('checkpoints', () => {
    it('finds whole sentences in a stretch, starting at a sentence start', () => {
        const s = sentencesIn(words, 3, words.length);
        expect(words[s[0].start]).toBe('Heavy');
        expect(s.every(x => /\.$/.test(words[x.end - 1]))).toBe(true);
    });

    it('builds a cloze with the answer among four distinct choices from the text', () => {
        const q = buildCloze(words, 0, words.length, { random: seq([0.1, 0.7, 0.3, 0.9, 0.5]) });
        expect(q).not.toBeNull();
        expect(q.options).toHaveLength(4);
        expect(new Set(q.options).size).toBe(4);
        expect(q.options[q.answerIndex]).toBe(q.answer);
        expect(q.sentence).toContain('_____');
        expect(q.sentence).not.toContain(q.answer);
        for (const o of q.options) expect(text.toLowerCase()).toContain(o);
        // No distractor appears in the sentence itself.
        for (const o of q.options.filter(x => x !== q.answer)) expect(q.sentence.toLowerCase()).not.toContain(o);
    });

    it('returns null when there is no whole sentence to ask about', () => {
        expect(buildCloze(words, 0, 4)).toBeNull();
    });

    it('steps words-per-flash up after four right and down after two misses in three', () => {
        const right = Array(4).fill({ ok: true, size: 3 });
        expect(nextChunkSize(right, 3)).toBe(4);
        expect(nextChunkSize([...right, { ok: false, size: 3 }, { ok: true, size: 3 }, { ok: false, size: 3 }], 3)).toBe(2);
        expect(nextChunkSize(right.map(e => ({ ...e, size: 5 })), 5)).toBe(5);
        expect(nextChunkSize([{ ok: false, size: 2 }, { ok: false, size: 2 }], 2)).toBe(2);
        expect(nextChunkSize(right.slice(0, 3), 3)).toBe(3);
    });
});

describe('speed trace', () => {
    it('buckets speed, marks slow buckets and records rewinds', () => {
        const samples = [];
        for (let t = 0; t <= 20; t++) samples.push({ t, idx: t * 5, slow: t === 15 });
        samples.push({ t: 21, idx: 90, slow: false });
        // A 2,000-word scrub forward is not reading speed.
        samples.push({ t: 22, idx: 2090, slow: false }, { t: 23, idx: 2095, slow: false });
        const { buckets, rewinds } = speedTrace(samples, 10, [21]);
        expect(buckets[0].wpm).toBe(300);
        expect(buckets[1].slow).toBe(true);
        expect(Math.max(...buckets.map(b => b.wpm))).toBeLessThan(400);
        expect(rewinds).toEqual([21]);
    });
});

describe('difficulty', () => {
    it('rates rare words and long sentences harder, buckets stretched to 0..1', () => {
        const rank = new Map(['the', 'cat', 'sat', 'mat'].map((w, i) => [w, i]));
        const s = difficultyScores('The cat sat. The zymurgical ontogeny persisted interminably.'.split(' '), rank);
        expect(s[1]).toBeLessThan(s[4]);
        const b = difficultyBuckets(s, 2);
        expect(b).toEqual([0, 1]);
    });

    it('easeCosts slows before a hard stretch and keeps the mean at 1', () => {
        const costs = Array(100).fill(1);
        const scores = Array.from({ length: 100 }, (_, i) => (i >= 60 && i < 80 ? 1 : 0));
        const eased = easeCosts(costs, scores, { window: 20 });
        expect(eased.reduce((a, b) => a + b, 0) / 100).toBeCloseTo(1, 6);
        expect(eased[50]).toBeGreaterThan(eased[10]);
        expect(eased[90]).toBeLessThan(eased[55]);
    });
});

describe('review regressions', () => {
    it('sampleAcross takes the start, middle and end of a long text', async () => {
        const { sampleAcross } = await import('./ai');
        const text = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(' ');
        const out = sampleAcross(text, 300).split(/\s+/);
        expect(out).toHaveLength(300);
        expect(out[0]).toBe('w0');
        expect(out).toContain('w1450');
        expect(out.at(-1)).toBe('w2999');
    });

    it('estimateHiddenTops keeps positions increasing through unrendered paragraphs', async () => {
        const { estimateHiddenTops } = await import('../components/ScrollText');
        let index = 0;
        const paragraphs = [5, 5, 5, 5].map(n => Array.from({ length: n }, () => ({ word: 'word', index: index++ })));
        const tops = new Array(20).fill(0);
        for (let i = 10; i < 15; i++) tops[i] = 300 + i;          // paragraph 2 rendered
        const totals = [0, 100, 200, 300, 400];
        const out = estimateHiddenTops(tops, paragraphs, 2, 3, totals, { linePx: 30, perLine: 70, afterBase: 330 });
        for (let i = 1; i < 20; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
        expect(out[19]).toBeGreaterThan(330);
        expect(out[0]).toBeGreaterThan(0);
    });
});
