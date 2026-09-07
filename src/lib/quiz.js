export const QUIZ_QUESTION_COUNT = 5;

// Below this many valid questions the quiz can't measure anything useful, so
// the session is recorded as unscored practice instead of a bad signal.
export const MIN_VALID_QUESTIONS = 3;

/**
 * Shared across every passage-generating prompt. Two questions with four
 * options gave a 25% floor from guessing and only three possible scores, so
 * the adaptive engine was reacting mostly to noise. These rules push for
 * questions that cannot be answered without having read the specific text.
 */
export const QUIZ_INSTRUCTIONS = `Write exactly ${QUIZ_QUESTION_COUNT} multiple-choice comprehension questions with 4 options each.

Rules for the questions:
- Every question must be answerable ONLY by someone who read this exact passage. If a well-read person could answer it from the title, the general topic, or common knowledge, rewrite it.
- At least two questions must hinge on a specific detail stated in the passage: a number, a name, a date, an order of events, or a stated cause.
- At least one question must require connecting two separate parts of the passage.
- Ask about the passage's overall argument at most once. Do not pad with "what is the main idea" variants.
- The correct option must be stated or directly entailed by the passage, not merely consistent with it.

Rules for the options:
- All four must be plausible to someone who did not read carefully, drawn from the same domain, and similar in length and specificity.
- No joke options, no "all of the above", no "none of the above", no option that is obviously absurd.`;

function shuffled(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

/**
 * Language models favour particular answer positions, so a model that tends to
 * put the correct option third would let you score well without reading.
 * Shuffling client-side removes that and remaps the answer index.
 */
export function shuffleOptions(question) {
    const paired = question.options.map((text, i) => ({ text, correct: i === question.answer }));
    const mixed = shuffled(paired);
    return {
        ...question,
        options: mixed.map(o => o.text),
        answer: mixed.findIndex(o => o.correct)
    };
}

const isUsable = (q) =>
    q &&
    typeof q.q === 'string' && q.q.trim().length > 0 &&
    Array.isArray(q.options) && q.options.length >= 3 &&
    q.options.every(o => typeof o === 'string' && o.trim().length > 0) &&
    new Set(q.options.map(o => o.trim().toLowerCase())).size === q.options.length &&
    Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length;

/**
 * Drops malformed questions (a bad answer index, duplicate options, empty
 * strings) rather than trusting whatever the model returned, then shuffles.
 * Returns [] when too few survive, which makes the session unscored.
 */
export function normalizeQuestions(raw) {
    if (!Array.isArray(raw)) return [];
    const usable = raw.filter(isUsable).map(shuffleOptions);
    return usable.length >= MIN_VALID_QUESTIONS ? usable : [];
}

export const scoreQuiz = (questions, answers) =>
    Math.round((answers.filter((a, i) => a === questions[i]?.answer).length / questions.length) * 100);
