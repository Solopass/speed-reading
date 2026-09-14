import { extractJson } from './ai';

// Transport for a local Ollama server. Same contract as gemini.js: take a
// prompt (and optionally a schema), resolve to the parsed JSON object, and
// throw an Error whose message a reader can act on.

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

// Generation on a local GPU can take a while for a thinking model writing a
// 560-word push drill plus questions; past this the request is abandoned.
const TIMEOUT_MS = 180_000;

const trimUrl = (url) => (typeof url === 'string' && url.trim() ? url.trim() : DEFAULT_OLLAMA_URL).replace(/\/+$/, '');

/**
 * The prompt specs in ai.js use Gemini's schema dialect (upper-case type
 * names). Ollama's `format` takes standard JSON Schema, so types are
 * lower-cased recursively and everything else is carried over.
 */
export function toJsonSchema(schema) {
    if (Array.isArray(schema)) return schema.map(toJsonSchema);
    if (!schema || typeof schema !== 'object') return schema;

    const out = {};
    for (const [key, value] of Object.entries(schema)) {
        if (key === 'type' && typeof value === 'string') out.type = value.toLowerCase();
        else if (key === 'properties' && value && typeof value === 'object') {
            out.properties = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, toJsonSchema(sub)]));
        } else if (key === 'items') out.items = toJsonSchema(value);
        else out[key] = value;
    }
    return out;
}

// Embedding models are listed by /api/tags but can't chat.
const isChatModel = (m) => !/embed/i.test(m?.name ?? '') && !/bert/i.test(m?.details?.family ?? '');

/** Names of installed chat models, smallest first. */
export async function listModels(baseUrl, { signal } = {}) {
    let response;
    try {
        response = await fetch(`${trimUrl(baseUrl)}/api/tags`, { signal });
    } catch {
        throw new Error(unreachable(baseUrl));
    }
    if (!response.ok) throw new Error(`Ollama answered ${response.status} when listing models.`);
    const data = await response.json();
    return (Array.isArray(data?.models) ? data.models : [])
        .filter(isChatModel)
        .sort((a, b) => (a.size ?? 0) - (b.size ?? 0))
        .map(m => m.name);
}

const infoCache = new Map();

/** Family and capabilities of one model, from /api/show. Cached per server + model. */
export async function modelInfo(baseUrl, model) {
    const key = `${trimUrl(baseUrl)}|${model}`;
    if (!infoCache.has(key)) {
        infoCache.set(key, (async () => {
            try {
                const response = await fetch(`${trimUrl(baseUrl)}/api/show`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model })
                });
                if (!response.ok) return { family: '', capabilities: [] };
                const data = await response.json();
                return {
                    family: data?.details?.family ?? '',
                    capabilities: Array.isArray(data?.capabilities) ? data.capabilities : []
                };
            } catch {
                infoCache.delete(key);
                return { family: '', capabilities: [] };
            }
        })());
    }
    return infoCache.get(key);
}

/**
 * How much a model should think before answering. Measured on this app's
 * prompts (RX 9070 XT, 2026-09-14):
 * - gpt-oss at "medium" took 111s for a push drill, "low" took 20s with the same
 *   quiz quality; `false` breaks its JSON entirely, so it always gets a level.
 * - Other thinking models (gemma4, qwen3) are 5x faster with thinking off and
 *   still produced five usable questions.
 */
export function thinkSetting({ family, capabilities }) {
    if (/gptoss|gpt-oss/i.test(family ?? '')) return 'low';
    if (Array.isArray(capabilities) && capabilities.includes('thinking')) return false;
    return undefined;
}

const unreachable = (baseUrl) =>
    `Can't reach Ollama at ${trimUrl(baseUrl)}. Is it running? ` +
    'If this page is served from something other than localhost, add its address to OLLAMA_ORIGINS and restart Ollama.';

/**
 * Calls Ollama's chat endpoint and returns the parsed JSON payload.
 *
 * Uses /api/chat, not /api/generate: generate plus a JSON format breaks
 * thinking models (gpt-oss, qwen3, gemma4), whereas chat keeps the reasoning
 * in `message.thinking` and the answer in `message.content`.
 *
 * `tools` means web search (the video summary), which a local model can't do.
 */
export async function generateJson({ prompt, schema, tools }, { baseUrl, model } = {}) {
    if (tools) {
        throw new Error('This feature needs web search, which a local model can\'t do. Use the copy/paste panel for it.');
    }
    if (typeof model !== 'string' || !model.trim()) {
        throw new Error('No local model chosen. Pick one under Settings → AI.');
    }

    const think = thinkSetting(await modelInfo(baseUrl, model.trim()));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const body = {
        model: model.trim(),
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        format: schema ? toJsonSchema(schema) : 'json',
        ...(think === undefined ? {} : { think }),
        // Thinking tokens count against num_predict, so leave room rather than
        // letting a long reasoning pass truncate the JSON.
        options: { num_ctx: 16384, num_predict: 8192 },
        keep_alive: '10m'
    };

    let response;
    try {
        response = await fetch(`${trimUrl(baseUrl)}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });
    } catch (err) {
        if (err?.name === 'AbortError') {
            throw new Error(`The local model took longer than ${TIMEOUT_MS / 1000}s. Try a smaller model in Settings.`);
        }
        throw new Error(unreachable(baseUrl));
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        if (response.status === 404 && /not found/i.test(detail)) {
            throw new Error(`Ollama doesn't have the model "${model}". Pick another in Settings, or run: ollama pull ${model}`);
        }
        throw new Error(`Ollama ${response.status}: ${detail.slice(0, 300)}`);
    }

    const result = await response.json();
    const text = result?.message?.content;

    if (typeof text !== 'string' || !text.trim()) {
        if (result?.done_reason === 'length') {
            throw new Error('The local model ran out of room before answering (it spent its budget thinking). Try again or pick a non-thinking model.');
        }
        throw new Error('The local model returned no text.');
    }

    return extractJson(text);
}
