import { QUIZ_INSTRUCTIONS, QUIZ_QUESTION_COUNT } from './quiz';

// Request shaping and response parsing, shared by two paths: a direct Gemini
// call, and a copy/paste exchange with whatever assistant the user already has
// open in a browser tab. The second path needs the JSON shape spelled out in
// the prompt, since nothing is enforcing a schema on the other end.

const QUESTION_SCHEMA = {
    type: 'ARRAY',
    description: `Exactly ${QUIZ_QUESTION_COUNT} comprehension questions, each with 4 options.`,
    items: {
        type: 'OBJECT',
        properties: {
            q: { type: 'STRING' },
            options: { type: 'ARRAY', items: { type: 'STRING' } },
            answer: { type: 'INTEGER', description: '0-based index of the correct option' }
        },
        required: ['q', 'options', 'answer']
    }
};

const QUESTIONS_SHAPE = '"questions": [{"q": string, "options": [string, string, string, string], "answer": number}]';

export function passageSpec({ topic, difficulty }) {
    return {
        label: 'reading passage',
        prompt: `Write a self-contained reading passage about "${topic}" at difficulty ${difficulty}/10, between 200 and 300 words. Include concrete specifics — numbers, names, dates, causes — so that comprehension can actually be tested.

${QUIZ_INSTRUCTIONS}`,
        schema: {
            type: 'OBJECT',
            properties: { title: { type: 'STRING' }, text: { type: 'STRING' }, questions: QUESTION_SCHEMA },
            required: ['title', 'text', 'questions']
        },
        shape: `{"title": string, "text": string, ${QUESTIONS_SHAPE}}`
    };
}

export function pushSpec({ topic, difficulty }) {
    return {
        label: 'speed push drill',
        prompt: `Write two consecutive sections of a reading passage about "${topic}" at difficulty ${difficulty}/10.

sectionA: roughly 280 words introducing the subject, dense with concrete specifics.
sectionB: roughly 280 words continuing directly from section A, introducing NEW specifics not mentioned in section A.

${QUIZ_INSTRUCTIONS}

Critically: every question must be answerable from section B alone. A reader who saw only section A must not be able to answer any of them.`,
        schema: {
            type: 'OBJECT',
            properties: {
                title: { type: 'STRING' }, sectionA: { type: 'STRING' }, sectionB: { type: 'STRING' }, questions: QUESTION_SCHEMA
            },
            required: ['title', 'sectionA', 'sectionB', 'questions']
        },
        shape: `{"title": string, "sectionA": string, "sectionB": string, ${QUESTIONS_SHAPE}}`
    };
}

export function coachSpec({ stats, effectiveWpm, comprehension, scoredCount, recent }) {
    return {
        label: 'coaching diagnostic',
        prompt: `Analyze this speed reading data and provide a professional coaching diagnosis and prescription.
Target speed: ${stats.targetWpm} WPM
Peak raw speed: ${stats.highestWpm} WPM
Recent effective WPM (speed x retention): ${effectiveWpm ?? 'not yet measured'}
Average comprehension: ${comprehension === null ? 'not yet measured' : comprehension + '%'}
Sessions completed: ${stats.sessionsCompleted} (${scoredCount} with a comprehension quiz)
Current streak: ${stats.streak} days
Recent quizzed sessions, oldest first: ${recent || 'none'}

Give a grade (S, A, B, C, D). Keep diagnosis and prescription to a short paragraph each.`,
        schema: {
            type: 'OBJECT',
            properties: { grade: { type: 'STRING' }, diagnosis: { type: 'STRING' }, prescription: { type: 'STRING' } },
            required: ['grade', 'diagnosis', 'prescription']
        },
        shape: '{"grade": string, "diagnosis": string, "prescription": string}'
    };
}

export function youtubeSpec({ url }) {
    return {
        label: 'video summary',
        prompt: `Summarize the content of this YouTube video URL: ${url}. Write an educational 200-300 word reading passage capturing its core ideas, keeping the concrete specifics — numbers, names, claims — from the video.

${QUIZ_INSTRUCTIONS}`,
        // Search grounding and responseSchema cannot be combined in one request,
        // so this path relies on the shape being stated in the prompt.
        tools: [{ google_search: {} }],
        shape: `{"title": string, "text": string, ${QUESTIONS_SHAPE}}`
    };
}

/** The prompt to hand to an assistant in a browser tab, shape instructions included. */
export const manualPrompt = (spec) => `${spec.prompt}

Reply with raw JSON only. No markdown fences, no commentary before or after. Match this shape exactly:
${spec.shape}`;

/**
 * Pulls a JSON object out of whatever the user pasted. Assistants wrap replies
 * in prose and code fences, so this tolerates a preamble, a trailing sign-off,
 * and fences, and scans for the outermost balanced object rather than trusting
 * the first and last brace (which breaks on nested objects or braces in text).
 */
export function extractJson(raw) {
    if (typeof raw !== 'string' || !raw.trim()) {
        throw new Error('Nothing pasted yet.');
    }

    let text = raw.trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) text = fenced[1].trim();

    const start = text.indexOf('{');
    if (start === -1) throw new Error('No JSON found in that. Copy the assistant\'s whole reply.');

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let i = start; i < text.length; i++) {
        const char = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === '{') depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) { end = i; break; }
        }
    }

    if (end === -1) throw new Error('That JSON looks cut off — copy the whole reply.');

    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        throw new Error('That did not parse as JSON. Copy the assistant\'s reply exactly as it appears.');
    }
}

/**
 * Asks a model to answer the questions with no passage in front of it.
 *
 * The generation prompt demands questions that cannot be answered without
 * reading the text, but nothing was checking that it complied. A question
 * answerable from general knowledge inflates your comprehension score, which
 * pushes your target speed up on a signal that measured nothing — the exact
 * failure the five-question rewrite was meant to close.
 *
 * Questions are passed in already normalised and shuffled, so the indices here
 * match the ones that will be scored.
 */
export function verifySpec({ questions }) {
    const listed = questions
        .map((q, i) => {
            const options = q.options.map((o, j) => `   (${j}) ${o}`).join('\n');
            return `${i + 1}. ${q.q}\n${options}`;
        })
        .join('\n\n');

    return {
        label: 'question check',
        prompt: `Below are multiple-choice questions written about a passage you have NOT been given. Do not guess.

For each question, decide whether you can determine the correct answer from general knowledge alone, without the passage. If you can, give the 0-based index of that option. If you genuinely cannot know, give -1.

Answering -1 is the expected result for a well-written comprehension question. Only give an index when you are confident the answer is knowable without the text.

${listed}`,
        schema: {
            type: 'OBJECT',
            properties: {
                answers: {
                    type: 'ARRAY',
                    description: 'One entry per question, in order: the 0-based index if knowable without the passage, otherwise -1.',
                    items: { type: 'INTEGER' }
                }
            },
            required: ['answers']
        },
        shape: '{"answers": [number, ...]}'
    };
}

/** Below this many surviving questions there is not enough left to score on. */
export const MIN_VERIFIED_QUESTIONS = 3;

/**
 * Removes questions the model answered correctly without the passage. Returns
 * the original set unchanged when the check would leave too few to score, since
 * a three-question quiz beats silently falling back to unscored practice.
 */
export function dropGuessableQuestions(questions, blindAnswers) {
    if (!Array.isArray(blindAnswers) || blindAnswers.length !== questions.length) {
        return { questions, dropped: 0, applied: false };
    }

    const kept = questions.filter((q, i) => blindAnswers[i] !== q.answer);
    const dropped = questions.length - kept.length;

    if (dropped === 0) return { questions, dropped: 0, applied: true };
    if (kept.length < MIN_VERIFIED_QUESTIONS) return { questions, dropped: 0, applied: false };

    return { questions: kept, dropped, applied: true };
}
