import { afterEach, describe, expect, it, vi } from 'vitest';

// modelInfo caches per server + model at module level, so each case loads a
// fresh copy of the module.
const load = async () => {
    vi.resetModules();
    return import('./ollama');
};

/**
 * Routes fetch by endpoint: /api/show describes the model, /api/chat answers.
 * Returns the mock so tests can inspect what was sent.
 */
const serve = ({ show = { details: { family: 'gptoss' }, capabilities: ['completion', 'thinking'] }, chat, tags } = {}) => {
    const fetchMock = vi.fn(async (url) => {
        if (url.endsWith('/api/show')) return { ok: true, status: 200, json: async () => show };
        if (url.endsWith('/api/tags')) return { ok: true, status: 200, json: async () => tags };
        const reply = typeof chat === 'function' ? chat() : chat;
        return reply.ok === false
            ? { ok: false, status: reply.status, text: async () => reply.body }
            : { ok: true, status: 200, json: async () => reply };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
};

const chatBody = (fetchMock) => JSON.parse(fetchMock.mock.calls.find(([url]) => url.endsWith('/api/chat'))[1].body);

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('toJsonSchema', () => {
    it('lower-cases Gemini type names all the way down', async () => {
        const { toJsonSchema } = await load();
        const converted = toJsonSchema({
            type: 'OBJECT',
            properties: {
                title: { type: 'STRING' },
                questions: {
                    type: 'ARRAY',
                    description: 'five of them',
                    items: { type: 'OBJECT', properties: { answer: { type: 'INTEGER' } }, required: ['answer'] }
                }
            },
            required: ['title', 'questions']
        });
        expect(converted).toEqual({
            type: 'object',
            properties: {
                title: { type: 'string' },
                questions: {
                    type: 'array',
                    description: 'five of them',
                    items: { type: 'object', properties: { answer: { type: 'integer' } }, required: ['answer'] }
                }
            },
            required: ['title', 'questions']
        });
    });

    // A property literally called "type" must not be mistaken for the type keyword.
    it('leaves property names alone even when one is called type', async () => {
        const { toJsonSchema } = await load();
        expect(toJsonSchema({ type: 'OBJECT', properties: { type: { type: 'STRING' } } }))
            .toEqual({ type: 'object', properties: { type: { type: 'string' } } });
    });
});

describe('thinkSetting', () => {
    // Measured: gpt-oss with think=false returned unparseable JSON, and at
    // "medium" a push drill took 111s against 20s at "low".
    it('gives gpt-oss a low reasoning level, never false', async () => {
        const { thinkSetting } = await load();
        expect(thinkSetting({ family: 'gptoss', capabilities: ['thinking'] })).toBe('low');
    });

    it('turns thinking off for other thinking models', async () => {
        const { thinkSetting } = await load();
        expect(thinkSetting({ family: 'gemma4', capabilities: ['completion', 'thinking'] })).toBe(false);
    });

    it('sends nothing for models that cannot think', async () => {
        const { thinkSetting } = await load();
        expect(thinkSetting({ family: 'llama', capabilities: ['completion'] })).toBeUndefined();
    });
});

describe('generateJson', () => {
    it('uses the chat endpoint with the schema as format and parses the content', async () => {
        const fetchMock = serve({ chat: { message: { content: '{"grade": "A"}' }, done_reason: 'stop' } });
        const { generateJson } = await load();
        const result = await generateJson(
            { prompt: 'coach me', schema: { type: 'OBJECT', properties: { grade: { type: 'STRING' } } } },
            { baseUrl: 'http://127.0.0.1:11434/', model: 'sol-fast' }
        );
        expect(result).toEqual({ grade: 'A' });

        const [url] = fetchMock.mock.calls.find(([u]) => u.endsWith('/api/chat'));
        expect(url).toBe('http://127.0.0.1:11434/api/chat');
        const body = chatBody(fetchMock);
        expect(body.model).toBe('sol-fast');
        expect(body.stream).toBe(false);
        expect(body.messages).toEqual([{ role: 'user', content: 'coach me' }]);
        expect(body.format).toEqual({ type: 'object', properties: { grade: { type: 'string' } } });
        expect(body.think).toBe('low');
    });

    it('asks for plain JSON when there is no schema', async () => {
        const fetchMock = serve({ show: { details: { family: 'gemma4' }, capabilities: ['thinking'] }, chat: { message: { content: '{"ok": true}' } } });
        const { generateJson } = await load();
        await generateJson({ prompt: 'x' }, { model: 'gemma4:12b' });
        const body = chatBody(fetchMock);
        expect(body.format).toBe('json');
        expect(body.think).toBe(false);
    });

    it('tolerates fences and a preamble, like the other paths', async () => {
        serve({ chat: { message: { content: 'Here you go:\n```json\n{"n": 1}\n```' } } });
        const { generateJson } = await load();
        await expect(generateJson({ prompt: 'x' }, { model: 'sol-fast' })).resolves.toEqual({ n: 1 });
    });

    it('refuses tool requests instead of silently answering without search', async () => {
        const fetchMock = serve({ chat: { message: { content: '{}' } } });
        const { generateJson } = await load();
        await expect(generateJson({ prompt: 'x', tools: [{ google_search: {} }] }, { model: 'sol-fast' }))
            .rejects.toThrow(/web search/);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('needs a model name', async () => {
        const { generateJson } = await load();
        await expect(generateJson({ prompt: 'x' }, { model: '  ' })).rejects.toThrow(/No local model/);
    });

    it('explains a missing model and how to get it', async () => {
        serve({ chat: { ok: false, status: 404, body: '{"error":"model \\"nope\\" not found, try pulling it first"}' } });
        const { generateJson } = await load();
        await expect(generateJson({ prompt: 'x' }, { model: 'nope' })).rejects.toThrow(/ollama pull nope/);
    });

    it('says the model ran out of room when it stopped on length with no answer', async () => {
        serve({ chat: { message: { content: '', thinking: 'a very long think' }, done_reason: 'length' } });
        const { generateJson } = await load();
        await expect(generateJson({ prompt: 'x' }, { model: 'sol-fast' })).rejects.toThrow(/ran out of room/);
    });

    it('reports an unreachable server in words, not a TypeError', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
        const { generateJson } = await load();
        await expect(generateJson({ prompt: 'x' }, { baseUrl: 'http://127.0.0.1:9', model: 'sol-fast' }))
            .rejects.toThrow(/Can't reach Ollama at http:\/\/127\.0\.0\.1:9/);
    });

    it('surfaces other HTTP errors with their body', async () => {
        serve({ chat: { ok: false, status: 500, body: 'out of memory' } });
        const { generateJson } = await load();
        await expect(generateJson({ prompt: 'x' }, { model: 'sol-fast' })).rejects.toThrow(/500: out of memory/);
    });

    it('looks the model up once and reuses it', async () => {
        const fetchMock = serve({ chat: { message: { content: '{}' } } });
        const { generateJson } = await load();
        await generateJson({ prompt: 'a' }, { model: 'sol-fast' });
        await generateJson({ prompt: 'b' }, { model: 'sol-fast' });
        expect(fetchMock.mock.calls.filter(([u]) => u.endsWith('/api/show'))).toHaveLength(1);
    });
});

describe('listModels', () => {
    it('drops embedding models and sorts smallest first', async () => {
        serve({
            tags: {
                models: [
                    { name: 'gpt-oss:120b', size: 60e9, details: { family: 'gptoss' } },
                    { name: 'nomic-embed-text:latest', size: 0.3e9, details: { family: 'nomic-bert' } },
                    { name: 'gemma4:12b', size: 7e9, details: { family: 'gemma4' } }
                ]
            }
        });
        const { listModels } = await load();
        await expect(listModels()).resolves.toEqual(['gemma4:12b', 'gpt-oss:120b']);
    });

    it('reports an unreachable server', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
        const { listModels } = await load();
        await expect(listModels('http://127.0.0.1:9')).rejects.toThrow(/Can't reach Ollama/);
    });
});
