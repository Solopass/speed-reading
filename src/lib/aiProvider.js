import { generateJson as geminiGenerate } from './gemini';
import { DEFAULT_OLLAMA_URL, generateJson as ollamaGenerate } from './ollama';

// Which AI path is in force, decided in one place so every view agrees.
//
//   local  - a model on your own Ollama server, no key and no copy/paste
//   gemini - direct Gemini calls, needs VITE_GEMINI_API_KEY
//   manual - the copy/paste panel, works with any assistant

export const AI_PROVIDERS = ['local', 'gemini', 'manual'];

export const DEFAULT_AI_SETTINGS = {
    aiProvider: 'local',
    ollamaUrl: DEFAULT_OLLAMA_URL,
    // Empty means "pick the best installed model automatically".
    ollamaModel: ''
};

/**
 * Preference order for the automatic choice. Measured against this app's own
 * prompts on 2026-09-14: sol-fast (gpt-oss 20B) wrote a passage in 11s, a push
 * drill in 18s and got the blind question check right; gemma4:12b was as fast
 * but guessed on the question check.
 */
/**
 * Settings saved before providers existed only had `useGeminiApi`. Someone who
 * had switched that off chose copy/paste on purpose, so keep them there;
 * everyone else moves to local models.
 */
export function migrateAiSettings(saved) {
    if (!saved || typeof saved !== 'object') return saved;
    if (AI_PROVIDERS.includes(saved.aiProvider)) return saved;
    const { useGeminiApi, ...rest } = saved;
    return { ...rest, aiProvider: useGeminiApi === false ? 'manual' : 'local' };
}

const PREFERRED =[/^sol-fast(:|$)/i, /^gpt-oss:20b/i, /^gpt-oss/i, /^gemma4/i, /^qwen3/i];

export function pickDefaultModel(names) {
    if (!Array.isArray(names) || names.length === 0) return '';
    for (const pattern of PREFERRED) {
        const hit = names.find(n => pattern.test(n));
        if (hit) return hit;
    }
    return names[0];
}

/**
 * Resolves settings plus runtime facts into what the views need.
 *
 * `local` is the live state of the Ollama server:
 * `{ status: 'checking' | 'ready' | 'unreachable', models: string[], error?: string }`.
 *
 * Returns `{ mode, generate, label, note, canSearch }`. `generate` is null
 * whenever the copy/paste panel should be shown instead, and `note` says why in
 * words a reader can act on.
 */
export function resolveAi({ settings = {}, geminiKey = false, local = { status: 'checking', models: [] } }) {
    const provider = AI_PROVIDERS.includes(settings.aiProvider) ? settings.aiProvider : DEFAULT_AI_SETTINGS.aiProvider;
    const manual = (note) => ({ mode: 'manual', generate: null, label: 'copy and paste', note, canSearch: false });

    if (provider === 'gemini') {
        if (!geminiKey) {
            return manual('Gemini is selected but no VITE_GEMINI_API_KEY is set, so this uses copy and paste instead.');
        }
        return {
            mode: 'gemini',
            generate: (request) => geminiGenerate(request),
            label: 'Gemini',
            note: 'Connected to your Gemini key — one click and it writes itself.',
            canSearch: true
        };
    }

    if (provider === 'local') {
        if (local.status === 'checking') {
            return manual('Connecting to your local models…');
        }
        const models = Array.isArray(local.models) ? local.models : [];
        if (local.status !== 'ready' || models.length === 0) {
            return manual(local.status === 'ready'
                ? 'Ollama is running but has no chat models installed, so this uses copy and paste. Pull one with: ollama pull gpt-oss:20b'
                : `${local.error || 'Ollama isn\'t reachable.'} Using copy and paste until it is.`);
        }

        const wanted = typeof settings.ollamaModel === 'string' ? settings.ollamaModel.trim() : '';
        const model = wanted && models.includes(wanted) ? wanted : pickDefaultModel(models);
        const fellBack = wanted && model !== wanted;

        return {
            mode: 'local',
            generate: (request) => ollamaGenerate(request, { baseUrl: settings.ollamaUrl, model }),
            label: model,
            model,
            note: fellBack
                ? `"${wanted}" isn't installed, so this is using ${model} on your own machine.`
                : `Running on ${model} on your own machine — no key, nothing leaves this PC.`,
            // Local models have no web search, which the video summary relies on.
            canSearch: false
        };
    }

    return manual('Copy and paste is selected: you get the prompt for any assistant and paste its reply back.');
}
