import { describe, expect, it } from 'vitest';
import {
    buildDrillPack, extractPassages, extractPhrases, extractTerms, normalizePack, pickPhrase, pickScanRound
} from './drillPack';

const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const para = (n) => `The archivists catalogued every manuscript in the monastery before winter came. Each manuscript recorded harvests, floods and the names of travelling merchants. ${'The archivists compared the manuscript margins with older ledgers and found careful corrections everywhere. '.repeat(n)}`;
const text = [para(4), para(5), para(3)].join('\n\n');

describe('extractPhrases', () => {
    it('gives phrases of each length from inside sentences, not ending on "the"', () => {
        const phrases = extractPhrases(text, { random: seq([0.1, 0.5, 0.9, 0.3, 0.7]) });
        for (const n of [2, 3, 4, 5]) {
            expect(phrases[n].length).toBeGreaterThan(0);
            for (const p of phrases[n]) {
                const ws = p.split(' ');
                expect(ws).toHaveLength(n);
                expect(ws.at(-1).toLowerCase()).not.toMatch(/^(the|of|and|a|an|in|to)$/);
                expect(p).not.toMatch(/[.,]/);
            }
        }
    });
});

describe('extractTerms and passages', () => {
    it('finds repeated uncommon words as key terms', () => {
        const rank = new Map([['every', 1], ['before', 2], ['winter', 900]]);
        const terms = extractTerms(text, rank);
        expect(terms).toContain('manuscript');
        expect(terms).toContain('archivists');
        expect(terms).not.toContain('winter');
    });

    it('keeps paragraphs of a scannable length', () => {
        const ps = extractPassages(text);
        expect(ps.length).toBeGreaterThan(0);
        for (const p of ps) expect(p.split(' ').length).toBeGreaterThanOrEqual(60);
    });
});

describe('buildDrillPack', () => {
    it('builds a shareable pack and refuses text that is too short', () => {
        const pack = buildDrillPack({ title: 'Monastery', text, source: { title: 'Book', chapter: 'One' }, now: new Date('2026-11-22T10:00:00Z') });
        expect(pack).toMatchObject({ kind: 'drill-pack', title: 'Monastery', source: { title: 'Book', chapter: 'One' }, createdAt: '2026-11-22' });
        expect(pack.passages.length).toBeGreaterThan(0);
        expect(() => buildDrillPack({ title: 'x', text: 'Too short.' })).toThrow(/too short/);
    });

    it('normalizePack keeps only known, string fields and rejects non-packs', () => {
        const pack = buildDrillPack({ title: 'Monastery', text });
        const evil = { ...pack, extra: 'drop me', terms: ['ok', 5, { x: 1 }], phrases: { 2: ['two words', null] } };
        const clean = normalizePack(JSON.parse(JSON.stringify(evil)));
        expect(clean.extra).toBeUndefined();
        expect(clean.terms).toEqual(['ok']);
        expect(clean.phrases[2]).toEqual(['two words']);
        expect(normalizePack({ kind: 'something-else' })).toBeNull();
        expect(normalizePack(null)).toBeNull();
    });

    it('picks phrases by size, falling back to the nearest size', () => {
        const pack = normalizePack({ kind: 'drill-pack', phrases: { 3: ['one two three'] }, passages: [] });
        expect(pickPhrase(pack, 3)).toEqual(['one', 'two', 'three']);
        expect(pickPhrase(pack, 5)).toEqual(['one', 'two', 'three']);
    });

    it('scan rounds target a key term that appears in the passage', () => {
        const pack = buildDrillPack({ title: 'Monastery', text });
        const round = pickScanRound(pack, seq([0, 0]));
        expect(round.text.toLowerCase()).toContain(round.target);
    });
});

describe('shared pack safety', () => {
    it('drops phrases whose length does not match their size, and gives packs without ids distinct ids', () => {
        const raw = { kind: 'drill-pack', phrases: { 3: ['one two three', 'only two', 'four words here now'] }, passages: [] };
        expect(normalizePack(raw).phrases[3]).toEqual(['one two three']);
        const a = normalizePack(raw);
        const b = normalizePack(raw);
        expect(a.id).not.toBe(b.id);
    });
});
