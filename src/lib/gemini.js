import { extractJson } from './ai';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? '';
const MODEL = import.meta.env.VITE_GEMINI_MODEL ?? 'gemini-3-flash-preview';

export const hasApiKey = () => API_KEY.trim().length > 0;

/**
 * Calls Gemini and returns the parsed JSON payload from the first candidate.
 * `schema` is optional — omit it when passing `tools`, since the API rejects
 * responseSchema and tool use in the same request.
 */
export async function generateJson({ prompt, schema, tools }) {
    if (!hasApiKey()) {
        throw new Error('Missing VITE_GEMINI_API_KEY. Copy .env.example to .env and add your key.');
    }

    const generationConfig = schema
        ? { responseMimeType: 'application/json', responseSchema: schema }
        : {};

    const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
        ...(tools ? { tools } : {})
    };

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(API_KEY)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }
    );

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Gemini API ${response.status}: ${detail.slice(0, 300)}`);
    }

    const result = await response.json();
    const candidate = result?.candidates?.[0];

    // Every text part, not just the first. A grounded reply (the YouTube path,
    // which uses tools and therefore cannot use a response schema) comes back
    // split across parts, and taking parts[0] alone truncates it or lands on a
    // part that has no text at all.
    const text = (Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
        .map(part => part?.text)
        .filter(part => typeof part === 'string')
        .join('');

    if (!text.trim()) {
        const reason = candidate?.finishReason;
        const blocked = result?.promptFeedback?.blockReason;
        if (blocked) throw new Error(`Gemini refused the prompt (${blocked}).`);
        throw new Error(reason && reason !== 'STOP'
            ? `Gemini stopped before answering (${reason}).`
            : 'Gemini returned no text.');
    }

    // The same tolerant parser the copy/paste path uses. Without a schema the
    // model wraps its JSON in prose and fences, and stripping backticks by hand
    // gives a raw SyntaxError instead of a message anyone can act on.
    return extractJson(text);
}
