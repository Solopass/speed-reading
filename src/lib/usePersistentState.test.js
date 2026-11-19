import { describe, expect, it } from 'vitest';
import { loadStored, saveStored } from './usePersistentState';

const memory = (init = {}) => {
    const data = { ...init };
    return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, data };
};

describe('loadStored', () => {
    it('parses and migrates a stored value', () => {
        const s = memory({ k: JSON.stringify([1, 2]) });
        expect(loadStored(s, 'k', (v) => v.length, 0)).toBe(2);
    });

    it('passes null to the migration when the key is missing', () => {
        expect(loadStored(memory(), 'k', (v) => v ?? 'default', 'x')).toBe('default');
    });

    it('falls back on corrupt JSON or missing storage', () => {
        expect(loadStored(memory({ k: '{oops' }), 'k', (v) => v, 'fb')).toBe('fb');
        expect(loadStored(null, 'k', () => { throw new Error('no'); }, () => 'lazy')).toBe('lazy');
    });
});

describe('saveStored', () => {
    it('writes JSON and reports failure instead of throwing', () => {
        const s = memory();
        expect(saveStored(s, 'k', { a: 1 })).toBe(true);
        expect(s.data.k).toBe('{"a":1}');
        expect(saveStored({ setItem: () => { throw new Error('quota'); } }, 'k', 1)).toBe(false);
    });
});
