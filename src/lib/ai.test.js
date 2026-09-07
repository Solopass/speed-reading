import { describe, expect, it } from 'vitest';
import {
    MIN_VERIFIED_QUESTIONS, coachSpec, dropGuessableQuestions, extractJson, manualPrompt,
    passageSpec, pushSpec, verifySpec, youtubeSpec
} from './ai';

describe('extractJson', () => {
    it('parses a bare object', () => {
        expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
    });

    it('ignores a preamble and a sign-off, which assistants always add', () => {
        expect(extractJson('Sure! Here is your passage:\n\n{"a": 1}\n\nLet me know if you want changes.')).toEqual({ a: 1 });
    });

    it('unwraps fenced code blocks, labelled or not', () => {
        expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
        expect(extractJson('```\n{"a": 1}\n```')).toEqual({ a: 1 });
        expect(extractJson('Here you go:\n```JSON\n{"a": 1}\n```')).toEqual({ a: 1 });
    });

    it('keeps nested objects intact rather than stopping at the first closing brace', () => {
        const value = { title: 'T', questions: [{ q: 'Q', options: ['a', 'b'], answer: 0 }] };
        expect(extractJson(JSON.stringify(value))).toEqual(value);
    });

    it('is not fooled by braces inside strings', () => {
        expect(extractJson('{"text": "a } brace and a { brace", "n": 2}')).toEqual({ text: 'a } brace and a { brace', n: 2 });
    });

    it('is not fooled by escaped quotes inside strings', () => {
        expect(extractJson('{"text": "she said \\"go\\" }", "n": 1}')).toEqual({ text: 'she said "go" }', n: 1 });
    });

    it('explains what is wrong rather than throwing a parser error', () => {
        expect(() => extractJson('')).toThrow(/Nothing pasted/);
        expect(() => extractJson(null)).toThrow(/Nothing pasted/);
        expect(() => extractJson('I cannot help with that.')).toThrow(/No JSON found/);
        expect(() => extractJson('{"a": 1')).toThrow(/cut off/);
        expect(() => extractJson('{oops not json}')).toThrow(/did not parse/);
    });
});

describe('prompt specs', () => {
    const specs = [
        passageSpec({ topic: 'Roman aqueducts', difficulty: 6 }),
        pushSpec({ topic: 'Roman aqueducts', difficulty: 6 }),
        coachSpec({ stats: { targetWpm: 400, highestWpm: 600, sessionsCompleted: 9, streak: 3 }, effectiveWpm: 320, comprehension: 80, scoredCount: 7, recent: '400 WPM / 80%' }),
        youtubeSpec({ url: 'https://youtu.be/abcdefghijk' })
    ];

    it('every spec can drive the copy/paste path', () => {
        specs.forEach(spec => {
            expect(spec.label).toBeTruthy();
            expect(spec.prompt).toBeTruthy();
            expect(spec.shape).toBeTruthy();
        });
    });

    it('embeds the caller inputs', () => {
        expect(passageSpec({ topic: 'Roman aqueducts', difficulty: 6 }).prompt).toContain('Roman aqueducts');
        expect(youtubeSpec({ url: 'https://youtu.be/abc' }).prompt).toContain('https://youtu.be/abc');
    });

    // Gemini rejects responseSchema alongside tool use, so the grounded call
    // must rely on the prompt for its shape.
    it('does not pair search grounding with a response schema', () => {
        const spec = youtubeSpec({ url: 'https://youtu.be/abc' });
        expect(spec.tools).toBeTruthy();
        expect(spec.schema).toBeUndefined();
    });

    it('asks for exactly the questions the quiz expects', () => {
        expect(passageSpec({ topic: 't', difficulty: 5 }).schema.properties.questions.description).toMatch(/5/);
    });
});

describe('manualPrompt', () => {
    const spec = passageSpec({ topic: 'Bioluminescence', difficulty: 4 });
    const text = manualPrompt(spec);

    it('carries the task, the shape, and a raw-JSON instruction', () => {
        expect(text).toContain('Bioluminescence');
        expect(text).toContain(spec.shape);
        expect(text).toMatch(/raw JSON only/i);
        expect(text).toMatch(/no markdown fences/i);
    });

    // The output of the manual path has to survive the parser on the way back.
    it('round-trips: a reply matching the stated shape parses', () => {
        const reply = `Here you go!\n\`\`\`json\n{"title": "Light", "text": "Some words.", "questions": [{"q": "Q?", "options": ["a","b","c","d"], "answer": 2}]}\n\`\`\``;
        const parsed = extractJson(reply);
        expect(parsed.title).toBe('Light');
        expect(parsed.questions[0].answer).toBe(2);
    });
});


const question = (text, answer = 0) => ({
    q: text, options: ['Alpha', 'Beta', 'Gamma', 'Delta'], answer
});

const FIVE = [
    question('What colour is the sky?'),
    question('How many gears survive?'),
    question('Who found the wreck?'),
    question('In what year?'),
    question('Which dial counted the games?')
];

describe('verifySpec', () => {
    const spec = verifySpec({ questions: FIVE });

    it('lists every question and every option', () => {
        expect((spec.prompt.match(/\(\d\)/g) || [])).toHaveLength(FIVE.length * 4);
        FIVE.forEach(q => expect(spec.prompt).toContain(q.q));
    });

    // The whole point is answering blind, so the passage must not leak in.
    it('tells the model it has not been given the passage', () => {
        expect(spec.prompt).toMatch(/have NOT been given/);
        expect(spec.prompt).toMatch(/Do not guess/);
    });

    it('makes -1 the expected answer, so it does not feel obliged to pick', () => {
        expect(spec.prompt).toMatch(/-1 is the expected result/);
    });

    it('can drive the copy and paste path too', () => {
        expect(spec.label).toBeTruthy();
        expect(spec.shape).toContain('answers');
    });
});

describe('dropGuessableQuestions', () => {
    it('keeps everything when nothing was knowable blind', () => {
        const result = dropGuessableQuestions(FIVE, [-1, -1, -1, -1, -1]);
        expect(result.questions).toHaveLength(5);
        expect(result.dropped).toBe(0);
        expect(result.applied).toBe(true);
    });

    it('drops exactly the questions answered correctly without the passage', () => {
        const result = dropGuessableQuestions(FIVE, [0, -1, -1, -1, -1]);
        expect(result.dropped).toBe(1);
        expect(result.questions).toHaveLength(4);
        expect(result.questions.some(q => q.q.includes('sky'))).toBe(false);
    });

    // A wrong blind guess is evidence the question is doing its job.
    it('keeps a question the model guessed at and got wrong', () => {
        const result = dropGuessableQuestions(FIVE, [2, -1, -1, -1, -1]);
        expect(result.dropped).toBe(0);
        expect(result.questions).toHaveLength(5);
    });

    it('refuses to gut the quiz below what can be scored', () => {
        const result = dropGuessableQuestions(FIVE, [0, 0, 0, -1, -1]);
        expect(result.applied).toBe(false);
        expect(result.questions).toHaveLength(5);
        expect(result.dropped).toBe(0);
    });

    it('keeps exactly the floor when the check lands on it', () => {
        const result = dropGuessableQuestions(FIVE, [0, 0, -1, -1, -1]);
        expect(result.questions).toHaveLength(MIN_VERIFIED_QUESTIONS);
        expect(result.applied).toBe(true);
    });

    it('ignores a malformed reply rather than trusting it', () => {
        expect(dropGuessableQuestions(FIVE, [0, 0]).applied).toBe(false);
        expect(dropGuessableQuestions(FIVE, null).applied).toBe(false);
        expect(dropGuessableQuestions(FIVE, 'nope').applied).toBe(false);
        expect(dropGuessableQuestions(FIVE, null).questions).toHaveLength(5);
    });
});
