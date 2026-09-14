import { describe, expect, it } from 'vitest';
import { migrateAiSettings, pickDefaultModel, resolveAi } from './aiProvider';

const ready = (models) => ({ status: 'ready', models });

describe('pickDefaultModel', () => {
    it('prefers sol-fast, then gpt-oss 20b, then gemma4', () => {
        expect(pickDefaultModel(['gemma4:12b', 'gpt-oss:20b', 'sol-fast:latest'])).toBe('sol-fast:latest');
        expect(pickDefaultModel(['gemma4:12b', 'gpt-oss:120b', 'gpt-oss:20b'])).toBe('gpt-oss:20b');
        expect(pickDefaultModel(['qwen3:32b', 'gemma4:12b'])).toBe('gemma4:12b');
    });

    it('falls back to the first model, or nothing', () => {
        expect(pickDefaultModel(['llama3.2:3b', 'mistral:7b'])).toBe('llama3.2:3b');
        expect(pickDefaultModel([])).toBe('');
        expect(pickDefaultModel(undefined)).toBe('');
    });

    // "sol-fastest" is not sol-fast.
    it('matches model names exactly at the tag boundary', () => {
        expect(pickDefaultModel(['sol-fastest', 'gemma4:12b'])).toBe('gemma4:12b');
    });
});

describe('resolveAi: local', () => {
    it('generates directly with the automatic model when Ollama is ready', () => {
        const ai = resolveAi({ settings: { aiProvider: 'local', ollamaModel: '' }, local: ready(['gemma4:12b', 'sol-fast:latest']) });
        expect(ai.mode).toBe('local');
        expect(ai.model).toBe('sol-fast:latest');
        expect(typeof ai.generate).toBe('function');
        expect(ai.canSearch).toBe(false);
    });

    it('uses the chosen model when it is installed', () => {
        const ai = resolveAi({ settings: { aiProvider: 'local', ollamaModel: 'gemma4:12b' }, local: ready(['gemma4:12b', 'sol-fast']) });
        expect(ai.model).toBe('gemma4:12b');
    });

    // A model removed with `ollama rm` must not strand every AI feature.
    it('falls back to the automatic model, and says so, when the chosen one is gone', () => {
        const ai = resolveAi({ settings: { aiProvider: 'local', ollamaModel: 'deleted:7b' }, local: ready(['sol-fast']) });
        expect(ai.model).toBe('sol-fast');
        expect(ai.note).toMatch(/"deleted:7b" isn't installed/);
    });

    it('uses copy and paste while the connection is still being checked', () => {
        const ai = resolveAi({ settings: { aiProvider: 'local' }, local: { status: 'checking', models: [] } });
        expect(ai.mode).toBe('manual');
        expect(ai.generate).toBeNull();
    });

    it('explains an unreachable server and keeps copy and paste available', () => {
        const ai = resolveAi({ settings: { aiProvider: 'local' }, local: { status: 'unreachable', models: [], error: "Can't reach Ollama at http://127.0.0.1:11434." } });
        expect(ai.mode).toBe('manual');
        expect(ai.note).toMatch(/Can't reach Ollama.*copy and paste/);
    });

    it('explains a server with no chat models', () => {
        const ai = resolveAi({ settings: { aiProvider: 'local' }, local: ready([]) });
        expect(ai.mode).toBe('manual');
        expect(ai.note).toMatch(/ollama pull/);
    });
});

describe('resolveAi: gemini and manual', () => {
    it('uses Gemini only with a key', () => {
        expect(resolveAi({ settings: { aiProvider: 'gemini' }, geminiKey: true }).mode).toBe('gemini');
        const noKey = resolveAi({ settings: { aiProvider: 'gemini' }, geminiKey: false });
        expect(noKey.mode).toBe('manual');
        expect(noKey.note).toMatch(/VITE_GEMINI_API_KEY/);
    });

    it('only Gemini can do the web-searching video summary', () => {
        expect(resolveAi({ settings: { aiProvider: 'gemini' }, geminiKey: true }).canSearch).toBe(true);
        expect(resolveAi({ settings: { aiProvider: 'local' }, local: ready(['sol-fast']) }).canSearch).toBe(false);
    });

    it('copy and paste never generates directly, even with a key present', () => {
        const ai = resolveAi({ settings: { aiProvider: 'manual' }, geminiKey: true, local: ready(['sol-fast']) });
        expect(ai.mode).toBe('manual');
        expect(ai.generate).toBeNull();
    });

    it('treats an unknown provider as the default (local)', () => {
        expect(resolveAi({ settings: { aiProvider: 'something-else' }, local: ready(['sol-fast']) }).mode).toBe('local');
    });
});

describe('migrateAiSettings', () => {
    it('keeps people who had switched Gemini off on copy and paste', () => {
        expect(migrateAiSettings({ useGeminiApi: false, goalWpm: 900 })).toEqual({ aiProvider: 'manual', goalWpm: 900 });
    });

    it('moves everyone else to local models and drops the old flag', () => {
        expect(migrateAiSettings({ useGeminiApi: true })).toEqual({ aiProvider: 'local' });
        expect(migrateAiSettings({ goalWpm: 900 })).toEqual({ aiProvider: 'local', goalWpm: 900 });
    });

    it('leaves already-migrated settings untouched', () => {
        const saved = { aiProvider: 'gemini', useGeminiApi: false };
        expect(migrateAiSettings(saved)).toBe(saved);
    });

    it('passes non-objects through', () => {
        expect(migrateAiSettings(null)).toBeNull();
        expect(migrateAiSettings(undefined)).toBeUndefined();
    });
});
