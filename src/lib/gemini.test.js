import { afterEach, describe, expect, it, vi } from 'vitest';

// The key is read into a module constant at import time, so each case loads a
// fresh copy of the module with the environment already stubbed.
const load = async (key = 'test-key') => {
    vi.resetModules();
    vi.stubEnv('VITE_GEMINI_API_KEY', key);
    return import('./gemini');
};

const respondWith = (parts, candidateExtra = {}, top = {}) => {
    const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts }, ...candidateExtra }], ...top })
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('hasApiKey', () => {
    it('is false for a missing or blank key', async () => {
        expect((await load('')).hasApiKey()).toBe(false);
        expect((await load('   ')).hasApiKey()).toBe(false);
    });

    it('is true once a key is configured', async () => {
        expect((await load('abc')).hasApiKey()).toBe(true);
    });

    it('refuses to call without one, rather than sending key=', async () => {
        const { generateJson } = await load('');
        await expect(generateJson({ prompt: 'x' })).rejects.toThrow(/VITE_GEMINI_API_KEY/);
    });
});

describe('generateJson', () => {
    it('parses a plain JSON reply', async () => {
        respondWith([{ text: '{"grade": "A"}' }]);
        const { generateJson } = await load();
        await expect(generateJson({ prompt: 'x' })).resolves.toEqual({ grade: 'A' });
    });

    // A grounded reply (the YouTube path, which uses tools and so cannot use a
    // response schema) arrives split across parts. Reading parts[0] alone
    // truncated it into invalid JSON.
    it('joins every text part instead of reading only the first', async () => {
        respondWith([{ text: '{"title": "Aqueducts",' }, { text: ' "text": "Water."}' }]);
        const { generateJson } = await load();
        await expect(generateJson({ prompt: 'x' })).resolves.toEqual({ title: 'Aqueducts', text: 'Water.' });
    });

    it('ignores parts that carry no text at all', async () => {
        respondWith([{ functionCall: { name: 'search' } }, { text: '{"ok": true}' }]);
        const { generateJson } = await load();
        await expect(generateJson({ prompt: 'x' })).resolves.toEqual({ ok: true });
    });

    // Without a schema the model wraps its answer in prose and fences.
    it('tolerates a preamble and code fences', async () => {
        respondWith([{ text: 'Sure!\n```json\n{"n": 1}\n```\nHope that helps.' }]);
        const { generateJson } = await load();
        await expect(generateJson({ prompt: 'x' })).resolves.toEqual({ n: 1 });
    });

    it('is not fooled by braces inside the generated text', async () => {
        respondWith([{ text: '{"text": "a } brace", "n": 2}' }]);
        const { generateJson } = await load();
        await expect(generateJson({ prompt: 'x' })).resolves.toEqual({ text: 'a } brace', n: 2 });
    });

    it('says a reply was cut off rather than throwing a parser error', async () => {
        respondWith([{ text: '{"title": "Half a rep' }]);
        const { generateJson } = await load();
        await expect(generateJson({ prompt: 'x' })).rejects.toThrow(/cut off/);
    });

    it('names the reason when the model stopped without answering', async () => {
        respondWith([], { finishReason: 'MAX_TOKENS' });
        const { generateJson } = await load();
        await expect(generateJson({ prompt: 'x' })).rejects.toThrow(/MAX_TOKENS/);
    });

    it('says so when the prompt itself was refused', async () => {
        respondWith([], {}, { promptFeedback: { blockReason: 'SAFETY' } });
        const { generateJson } = await load();
        await expect(generateJson({ prompt: 'x' })).rejects.toThrow(/refused the prompt \(SAFETY\)/);
    });

    it('reports an empty reply without blaming the parser', async () => {
        respondWith([{ text: '   ' }]);
        const { generateJson } = await load();
        await expect(generateJson({ prompt: 'x' })).rejects.toThrow(/no text/);
    });

    it('surfaces the HTTP status and body on a failed request', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false, status: 429, text: async () => 'Rate limited'
        })));
        const { generateJson } = await load();
        await expect(generateJson({ prompt: 'x' })).rejects.toThrow(/429.*Rate limited/);
    });
});

describe('request shaping', () => {
    it('sends a response schema when given one', async () => {
        const fetchMock = respondWith([{ text: '{}' }]);
        const { generateJson } = await load();
        await generateJson({ prompt: 'x', schema: { type: 'OBJECT' } });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.generationConfig.responseSchema).toEqual({ type: 'OBJECT' });
        expect(body.generationConfig.responseMimeType).toBe('application/json');
    });

    // The API rejects responseSchema alongside tool use, so the grounded call
    // must send tools and no schema.
    it('sends tools without a schema, never both', async () => {
        const fetchMock = respondWith([{ text: '{}' }]);
        const { generateJson } = await load();
        await generateJson({ prompt: 'x', tools: [{ google_search: {} }] });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.tools).toEqual([{ google_search: {} }]);
        expect(body.generationConfig.responseSchema).toBeUndefined();
    });

    it('escapes the key into the query string', async () => {
        const fetchMock = respondWith([{ text: '{}' }]);
        const { generateJson } = await load('a key/with+chars');
        await generateJson({ prompt: 'x' });
        expect(fetchMock.mock.calls[0][0]).toContain(`key=${encodeURIComponent('a key/with+chars')}`);
    });
});
