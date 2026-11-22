import { describe, expect, it } from 'vitest';
import { meaningDrillSpec, normalizeMeaningItems, validateMeaningItems } from './aiDrills';
import { packFromFileText, packFromHash, packToLink, LINK_PREFIX } from './packShare';
import { normalizePack } from './drillPack';

const source = 'The archivists catalogued every manuscript in the monastery before winter. Brother Anselm found careful corrections in a second hand.';
const item = (over) => ({ kind: 'phrase', prompt: 'careful corrections in a second hand', answer: 'Someone else later fixed the text', wrong: ['The ink had faded badly', 'A child had scribbled notes', 'The pages were torn out'], ...over });

describe('validateMeaningItems', () => {
    it('keeps items copied from the text and shuffles the options with the answer tracked', () => {
        const out = validateMeaningItems([item()], source, [], () => 0.3);
        expect(out).toHaveLength(1);
        expect(out[0].options).toHaveLength(4);
        expect(out[0].options[out[0].answer]).toBe('Someone else later fixed the text');
    });

    it('drops invented phrases, short option lists, duplicates and answers that repeat the prompt', () => {
        const out = validateMeaningItems([
            item({ prompt: 'a phrase that is not there' }),
            item({ wrong: ['only one'] }),
            item({ wrong: ['Someone else later fixed the text', 'x', 'y'] }),
            item({ answer: 'careful corrections in a second hand' }),
            item(), item()
        ], source);
        expect(out).toHaveLength(1);
    });

    it('accepts a key term from the pack even when not in this excerpt', () => {
        const out = validateMeaningItems([item({ kind: 'term', prompt: 'palimpsest' })], source, ['palimpsest']);
        expect(out).toHaveLength(1);
        expect(validateMeaningItems([item({ kind: 'term', prompt: 'nonsenseword' })], source, [])).toHaveLength(0);
    });

    it('spec includes the passages and terms', () => {
        const spec = meaningDrillSpec({ title: 'T', passages: ['Para one.'], terms: ['manuscript'] });
        expect(spec.prompt).toContain('Para one.');
        expect(spec.prompt).toContain('manuscript');
    });

    it('normalizeMeaningItems rejects malformed stored items', () => {
        const good = { kind: 'term', prompt: 'x', options: ['a', 'b', 'c', 'd'], answer: 2 };
        expect(normalizeMeaningItems([good, { ...good, answer: 4 }, { ...good, options: ['a'] }, { ...good, kind: 'evil' }])).toEqual([good]);
    });
});

describe('sharing packs', () => {
    const pack = normalizePack({ kind: 'drill-pack', id: 'p1', title: 'Monastery', phrases: { 2: ['two words'] }, passages: ['A paragraph.'], meaning: [{ kind: 'term', prompt: 'x', options: ['a', 'b', 'c', 'd'], answer: 1 }] });

    it('round-trips a pack through a link', async () => {
        const link = await packToLink(pack, 'https://example.test/app/');
        expect(link.startsWith(`https://example.test/app/${LINK_PREFIX}`)).toBe(true);
        const back = await packFromHash(link.slice(link.indexOf('#')));
        expect(back).toEqual(pack);
    });

    it('ignores damaged links and non-pack files', async () => {
        expect(await packFromHash('#pack=not-valid')).toBeNull();
        expect(await packFromHash('#other')).toBeNull();
        expect(() => packFromFileText('{"kind":"other"}')).toThrow(/not a drill pack/);
        expect(() => packFromFileText('nope')).toThrow(/not valid JSON/);
        expect(packFromFileText(JSON.stringify(pack)).title).toBe('Monastery');
    });
});

describe('share link limits', () => {
    it('refuses a link that inflates past the size limit (a decompression bomb)', async () => {
        const huge = { kind: 'drill-pack', title: 'x'.repeat(10), phrases: { 2: ['a b'] }, passages: ['y'.repeat(2_000_000)] };
        // Compress a huge payload directly, bypassing the cleaning a real pack goes through.
        const json = new TextEncoder().encode(JSON.stringify(huge));
        const packed = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
        let bin = ''; for (const b of packed) bin += String.fromCharCode(b);
        const hash = `#pack=${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
        expect(hash.length).toBeLessThan(20000);
        expect(await packFromHash(hash)).toBeNull();
    });
});
