// AI-written "Meaning at a glance" items for a drill pack. The model writes a
// meaning and three wrong ones for phrases, sentences and key terms taken from
// the pack's own passages; everything it returns is checked here before use.

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;

function shuffled(list, random) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** The request for meaning items, built from a pack's passages and key terms. */
export function meaningDrillSpec({ title, passages, terms = [], round = 0 }) {
    // Small requests (6 items, ~4,000 characters) so a local model answers in
    // time; each further round starts at different passages, so "More AI drills" varies.
    const list = passages ?? [];
    const start = list.length ? (round * 2) % list.length : 0;
    const text = [...list.slice(start), ...list.slice(0, start)].join('\n\n').slice(0, 4000);
    return {
        label: 'meaning drill',
        prompt: `You are making a speed-reading drill from the text below ("${title || 'Document'}"). Each item is flashed briefly, then the reader picks what it meant.

Write 6 items:
- 3 of kind "phrase": a phrase of 3 to 6 words copied EXACTLY from the text.
- 2 of kind "sentence": one short sentence (at most 20 words) copied EXACTLY from the text.
- 1 of kind "term": one of these key terms: ${terms.slice(0, 15).join(', ') || '(choose an important word from the text)'}.

For each item give "answer": what it means in this text, in plain words (at most 15 words), and "wrong": three meanings that sound just as plausible, are similar in length and style, but are wrong for this text. Do not copy the prompt into the answer.

TEXT:
${text}`,
        schema: {
            type: 'OBJECT',
            properties: {
                items: {
                    type: 'ARRAY',
                    items: {
                        type: 'OBJECT',
                        properties: {
                            kind: { type: 'STRING' },
                            prompt: { type: 'STRING' },
                            answer: { type: 'STRING' },
                            wrong: { type: 'ARRAY', items: { type: 'STRING' } }
                        },
                        required: ['kind', 'prompt', 'answer', 'wrong']
                    }
                }
            },
            required: ['items']
        },
        shape: '{"items": [{"kind": "phrase"|"sentence"|"term", "prompt": string, "answer": string, "wrong": [string, string, string]}]}'
    };
}

/**
 * Keeps only items that hold up: phrases and sentences really in the text (so
 * the model cannot invent them), terms from the pack or the text, sensible
 * lengths, four distinct options. Options are shuffled here; the model never
 * chooses where the right answer sits.
 * Returns [{ kind, prompt, options, answer }].
 */
export function validateMeaningItems(raw, sourceText, terms = [], random = Math.random) {
    const source = ` ${norm(sourceText)} `;
    const termSet = new Set(terms.map(t => t.toLowerCase()));
    const seen = new Set();
    const out = [];
    for (const item of Array.isArray(raw) ? raw : []) {
        const kind = String(item?.kind ?? '').toLowerCase();
        const prompt = String(item?.prompt ?? '').trim().replace(/\s+/g, ' ');
        const answer = String(item?.answer ?? '').trim();
        const wrong = Array.isArray(item?.wrong) ? item.wrong.map(w => String(w ?? '').trim()).filter(Boolean) : [];
        if (!['phrase', 'sentence', 'term'].includes(kind) || !prompt || !answer || wrong.length < 3) continue;
        const n = words(prompt);
        if (kind === 'phrase' && (n < 2 || n > 8)) continue;
        if (kind === 'sentence' && (n < 4 || n > 30)) continue;
        if (kind === 'term' && n > 3) continue;
        const inText = source.includes(` ${norm(prompt)} `);
        if ((kind === 'phrase' || kind === 'sentence') && !inText) continue;
        if (kind === 'term' && !inText && !termSet.has(prompt.toLowerCase())) continue;
        const options = [answer, ...wrong.slice(0, 3)];
        const keys = options.map(norm);
        if (new Set(keys).size < 4 || keys.includes(norm(prompt))) continue;
        if (options.some(o => o.length > 200)) continue;
        if (seen.has(norm(prompt))) continue;
        seen.add(norm(prompt));
        const order = shuffled([0, 1, 2, 3], random);
        out.push({ kind, prompt: prompt.slice(0, 300), options: order.map(i => options[i]), answer: order.indexOf(0) });
    }
    return out;
}

/** Cleans stored or shared meaning items (the shape validateMeaningItems produces). */
export function normalizeMeaningItems(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(it => it && ['phrase', 'sentence', 'term'].includes(it.kind)
        && typeof it.prompt === 'string' && it.prompt.trim()
        && Array.isArray(it.options) && it.options.length === 4 && it.options.every(o => typeof o === 'string' && o.trim())
        && Number.isInteger(it.answer) && it.answer >= 0 && it.answer < 4)
        .slice(0, 30)
        .map(it => ({ kind: it.kind, prompt: it.prompt.slice(0, 300), options: it.options.map(o => o.slice(0, 200)), answer: it.answer }));
}
