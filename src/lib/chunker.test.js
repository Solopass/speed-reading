import { describe, expect, it } from 'vitest';
import { buildChunks, chunkIndexAt, endsSentence, joinFlashWords, pauseAfter, tokenize, wordWeights } from './chunker';

const groups = (text, opts) => {
    const words = text.trim().split(/\s+/);
    return buildChunks(text, opts).map(c => words.slice(c.start, c.end).join(' '));
};

describe('buildChunks', () => {
    it('covers every word exactly once, in order', () => {
        const text = 'The old house stood at the end of a long and winding road, far from the village. Nobody lived there now.';
        const chunks = buildChunks(text, { maxWords: 5 });
        const n = text.split(/\s+/).length;
        let at = 0;
        for (const c of chunks) { expect(c.start).toBe(at); expect(c.end).toBeGreaterThan(c.start); at = c.end; }
        expect(at).toBe(n);
    });

    it('never runs a group across a sentence end', () => {
        const out = groups('It ended. The next one began slowly and then it ran.', { maxWords: 5 });
        expect(out[0]).toBe('It ended.');
        expect(out.every(g => !/\.\s\S/.test(g))).toBe(true);
    });

    it('does not end a group on an article or preposition', () => {
        const out = groups('She walked slowly down to the edge of the quiet river and sat on the bank for an hour', { maxWords: 5 });
        for (const g of out.slice(0, -1)) {
            expect(g.split(' ').at(-1), g).not.toMatch(/^(the|of|to|on|an|a|and|for)$/i);
        }
    });

    it('prefers to break at commas', () => {
        const out = groups('When the rain finally stopped, everyone went outside to look at the sky.', { maxWords: 5 });
        expect(out[0]).toBe('When the rain finally stopped,');
    });

    it('balances a sentence instead of leaving a one-word tail', () => {
        const out = groups('Six words make up this sentence.', { maxWords: 5 });
        expect(out.map(g => g.split(' ').length)).toEqual([3, 3]);
    });

    it('keeps 3-5 word groups in ordinary prose at max 5', () => {
        const text = 'The committee met on Tuesday to discuss the budget for next year and the plans for the new library building that the town had wanted for a very long time without any real progress being made by anyone involved.';
        const sizes = groups(text, { maxWords: 5 }).map(g => g.split(' ').length);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(5);
        expect(sizes.filter(s => s >= 3).length / sizes.length).toBeGreaterThan(0.8);
    });

    it('keeps a heading on its own', () => {
        const out = groups('Chapter One\n\nIt was a cold morning in the hills.', { maxWords: 5 });
        expect(out[0]).toBe('Chapter One');
        const out2 = groups('The Long Road\nIt was a cold morning in the hills.', { maxWords: 5 });
        expect(out2[0]).toBe('The Long Road');
    });

    it('does not treat wrapped prose lines as headings', () => {
        const text = 'The river carried silt down from the hills every spring and\nthe farmers waited for the floods to pass.';
        expect(groups(text, { maxWords: 5 }).some(g => g.includes('and the'))).toBe(true);
    });

    it('does not break at every line of a narrow wrapped column', () => {
        const text = 'The committee met on\nTuesday to discuss the\nbudget for next year\nand the new plans.';
        expect(groups(text, { maxWords: 5 }).some(g => /discuss the budget|the budget|budget for/.test(g))).toBe(true);
    });

    it('ends a sentence at "no." but not at "No. 5"', () => {
        expect(groups('The answer was no. Then she left the room.', { maxWords: 5 })[0]).toBe('The answer was no.');
        expect(groups('See item No. 5 on the list today.', { maxWords: 5 }).join(' | ')).not.toMatch(/No\. \|/);
    });

    it('does not split at abbreviations or initials', () => {
        const out = groups('Mr. Smith met J. Doe on the corner.', { maxWords: 5 });
        expect(out[0].startsWith('Mr. Smith')).toBe(true);
        expect(out.join(' | ')).not.toMatch(/Mr\. \|/);
    });

    it('fits fewer long words into a group', () => {
        const out = groups('Internationalization considerations notwithstanding, administrators overwhelmingly preferred straightforward documentation.', { maxWords: 5 });
        expect(out.every(g => g.length <= 50)).toBe(true);
    });

    it('keeps lone dashes attached to a neighbour', () => {
        const out = groups('He paused — just for a moment — and then he went on walking.', { maxWords: 5 });
        expect(out.some(g => g === '—' || g.startsWith('— ') && g.split(' ').length === 1)).toBe(false);
        expect(out.every(g => !/^—$/.test(g))).toBe(true);
    });

    it('falls back to fixed slices for one word or with grouping off', () => {
        expect(groups('a b c d e', { maxWords: 1 })).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(groups('the cat. a dog', { maxWords: 2, smart: false })).toEqual(['the cat.', 'a dog']);
    });

    it('handles empty text', () => {
        expect(buildChunks('', { maxWords: 4 })).toEqual([]);
    });
});

describe('helpers', () => {
    it('endsSentence knows abbreviations and initials', () => {
        expect(endsSentence('end.')).toBe(true);
        expect(endsSentence('said."')).toBe(true);
        expect(endsSentence('Really?')).toBe(true);
        expect(endsSentence('Dr.')).toBe(false);
        expect(endsSentence('e.g.')).toBe(false);
        expect(endsSentence('J.')).toBe(false);
        expect(endsSentence('U.S.')).toBe(false);
        expect(endsSentence('mostly.¹')).toBe(true);
        expect(endsSentence('no.')).toBe(true);
        expect(endsSentence('No.', '5')).toBe(false);
        expect(endsSentence('fig.', '3')).toBe(false);
        expect(endsSentence('.')).toBe(true);
    });

    it('tokenize matches the Reader split and records breaks', () => {
        const text = '  One two\nthree.\n\nFour  ';
        const t = tokenize(text);
        expect(t.map(x => x.word)).toEqual(text.trim().split(/\s+/));
        expect(t.map(x => x.gap)).toEqual([0, 1, 2, 0]);
    });

    it('chunkIndexAt finds the group holding a word', () => {
        const chunks = [{ start: 0, end: 3 }, { start: 3, end: 5 }, { start: 5, end: 9 }];
        expect(chunkIndexAt(chunks, 0)).toBe(0);
        expect(chunkIndexAt(chunks, 4)).toBe(1);
        expect(chunkIndexAt(chunks, 8)).toBe(2);
    });

    it('wordWeights average to 1 and favour long words', () => {
        const w = wordWeights(['a', 'extraordinarily', 'cat', 'the']);
        expect(w.reduce((s, x) => s + x, 0) / w.length).toBeCloseTo(1, 6);
        expect(w[1]).toBeGreaterThan(w[2]);
    });

    it('pauseAfter grows from comma to sentence to paragraph', () => {
        expect(pauseAfter('word,', 0)).toBeLessThan(pauseAfter('word.', 0));
        expect(pauseAfter('word.', 0)).toBeLessThan(pauseAfter('word.', 2));
        expect(pauseAfter('word', 0)).toBe(0);
    });
});

describe('joinFlashWords', () => {
    it('closes up stray punctuation for display', () => {
        expect(joinFlashWords(['for', 'decades', '.'])).toBe('for decades.');
        expect(joinFlashWords(['a', '(', 'this', ')', 'too'])).toBe('a (this) too');
        expect(joinFlashWords(['He', 'paused', '—', 'just'])).toBe('He paused — just');
    });
});

describe('rarity pacing', () => {
    it('gives rare words more time than common ones of the same length, mean still 1', () => {
        const rank = new Map([['house', 100], ['tiles', 15000]]);
        const words = ['house', 'tiles', 'zymic', 'house'];
        const w = wordWeights(words, rank);
        expect(w.reduce((s, x) => s + x, 0) / w.length).toBeCloseTo(1, 6);
        expect(w[1]).toBeGreaterThan(w[0]);
        expect(w[2]).toBeGreaterThan(w[1]);
        expect(wordWeights(words)[0]).toBeCloseTo(1, 6);
    });
});

describe('quote and parenthetical grouping', () => {
    it('keeps short dialogue quotes and parentheticals together in one flash', () => {
        const text = 'He whispered "not today" before leaving.';
        const words = text.split(/\s+/);
        const chunks = buildChunks(text, { maxWords: 3 }).map(c => words.slice(c.start, c.end).join(' '));
        expect(chunks.some(c => c.includes('"not today"'))).toBe(true);
    });
});
