import { describe, expect, it } from 'vitest';
import {
    FLASH_MAX_MS, FLASH_MIN_MS, buildFlashRound, candidateWords, createVocabItem, dueItems,
    migrateVocab, nextExposure, reviewItem, upsertVocab
} from './vocab';

const library = [
    {
        title: 'Vents',
        text: 'Hydrothermal vents support chemosynthetic communities. The vents were found near Galapagos in 1977. '
            + 'However, researchers described the ecosystems as unprecedented. Chemosynthetic bacteria thrive there.'
    },
    { title: 'Push', sectionA: 'Archimedes measured buoyancy with remarkable ingenuity.', sectionB: 'Nothing else here.' }
];

describe('candidateWords', () => {
    const words = candidateWords(library).map(c => c.word);

    it('finds long, uncommon words across text and push sections', () => {
        expect(words).toEqual(expect.arrayContaining(['hydrothermal', 'unprecedented', 'ingenuity', 'buoyancy', 'chemosynthetic']));
    });

    it('drops common long words and proper nouns', () => {
        expect(words).not.toContain('however');
        expect(words).not.toContain('researchers');
        expect(words).not.toContain('galapagos');
        // Archimedes only appears at a sentence start, where a capital proves nothing.
    });

    it('ranks rarer words first and keeps the sentence for context', () => {
        const all = candidateWords(library);
        const chemo = all.find(c => c.word === 'chemosynthetic');
        expect(chemo.count).toBe(2);
        expect(all.indexOf(chemo)).toBeGreaterThan(all.findIndex(c => c.word === 'unprecedented'));
        expect(all.find(c => c.word === 'buoyancy').context).toMatch(/^Archimedes measured buoyancy/);
    });

    it('skips excluded words', () => {
        expect(candidateWords(library, new Set(['buoyancy'])).map(c => c.word)).not.toContain('buoyancy');
    });
});

describe('review schedule', () => {
    const item = createVocabItem({ word: 'Buoyancy' }, '2026-01-01');

    it('starts due today, lower-cased', () => {
        expect(item).toMatchObject({ id: 'v-buoyancy', word: 'buoyancy', due: '2026-01-01', step: 0 });
    });

    it('good climbs the intervals, again drops back to tomorrow', () => {
        const good = reviewItem(item, 'good', '2026-01-01');
        expect(good).toMatchObject({ step: 1, due: '2026-01-04', reviews: 1 });
        const again = reviewItem(good, 'again', '2026-01-04');
        expect(again).toMatchObject({ step: 0, due: '2026-01-05', lapses: 1 });
        expect(reviewItem(item, 'easy', '2026-01-01').step).toBe(2);
    });

    it('dueItems lists only words due by today', () => {
        const later = { ...item, id: 'v-x', due: '2026-02-01' };
        expect(dueItems([item, later], '2026-01-10').map(i => i.id)).toEqual(['v-buoyancy']);
    });

    it('upsert replaces by id', () => {
        expect(upsertVocab([item], { ...item, note: 'floats' })).toHaveLength(1);
    });

    it('migrateVocab repairs bad records and drops junk', () => {
        const out = migrateVocab([{ word: 'Lacuna', step: 99, due: 'soon' }, { nope: 1 }, null]);
        expect(out).toHaveLength(1);
        expect(out[0].step).toBe(5);
        expect(out[0].due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(migrateVocab('x')).toEqual([]);
    });
});

describe('flash drill', () => {
    it('shortens after a hit, lengthens after a miss, within bounds', () => {
        expect(nextExposure(400, true)).toBe(340);
        expect(nextExposure(400, false)).toBe(520);
        expect(nextExposure(FLASH_MIN_MS, true)).toBe(FLASH_MIN_MS);
        expect(nextExposure(FLASH_MAX_MS, false)).toBe(FLASH_MAX_MS);
    });

    it('builds four distinct options including the target', () => {
        const round = buildFlashRound('lacuna', ['lacuna', 'zephyr', 'quorum', 'ephemeral', 'bastion', 'ZEPHYR'], () => 0.5);
        expect(round.options).toHaveLength(4);
        expect(new Set(round.options).size).toBe(4);
        expect(round.options[round.answer]).toBe('lacuna');
        expect(round.options).not.toContain('ephemeral');
    });
});

describe('migrateVocab duplicates', () => {
    it('keeps the first copy of a repeated word', () => {
        const out = migrateVocab([{ word: 'Lacuna', note: 'first' }, { word: 'lacuna', note: 'second' }]);
        expect(out).toHaveLength(1);
        expect(out[0].note).toBe('first');
    });
});

describe('frequency ranking', () => {
    it('parses the list into ranks', async () => {
        const { parseFrequencyList, rankOf } = await import('./vocab');
        const rank = parseFrequencyList('the\nriver\nflow\n\nriver\n');
        expect(rank.get('the')).toBe(0);
        expect(rank.get('river')).toBe(1);
        expect(rankOf('rivers', rank)).toBe(1);
        expect(rankOf('zephyr', rank)).toBe(Infinity);
    });

    it('ranks candidates by rarity in English and drops common words', async () => {
        const { candidateWords, parseFrequencyList, COMMON_RANK } = await import('./vocab');
        const list = Array.from({ length: COMMON_RANK + 10 }, (_, i) => `filler${i}`);
        list[5] = 'sustained';
        list[COMMON_RANK + 5] = 'microbes';
        const rank = parseFrequencyList(list.join('\n'));
        const lib = [{ title: 'T', text: 'Bacteria sustained the microbes and the tubeworms in symbiotic fashion.' }];
        const words = candidateWords(lib, new Set(), 40, rank).map(c => c.word);
        expect(words).not.toContain('sustained');
        expect(words.indexOf('tubeworms')).toBeLessThan(words.indexOf('microbes'));
        expect(words).toContain('fashion');
    });
});

describe('possessives and contractions', () => {
    it('folds possessives into the base word and skips contractions', () => {
        const lib = [{ title: 'T', text: "The cesspit's walls and the cesspit leaked. They wouldn't've noticed the waterborne illness." }];
        const words = candidateWords(lib).map(c => c.word);
        expect(words.filter(w => w.startsWith('cesspit'))).toEqual([]);
        expect(words).toContain('waterborne');
        expect(words.some(w => w.includes("'"))).toBe(false);
    });
});
