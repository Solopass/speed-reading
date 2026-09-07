import { describe, expect, it } from 'vitest';
import { MIN_VALID_QUESTIONS, normalizeQuestions, scoreQuiz, shuffleOptions } from './quiz';

const q = (overrides = {}) => ({
    q: 'What colour is the sky?',
    options: ['Blue', 'Green', 'Red', 'Yellow'],
    answer: 0,
    ...overrides
});

const manyValid = (n) => Array.from({ length: n }, (_, i) => q({ q: `Question ${i}` }));

describe('shuffleOptions', () => {
    it('keeps the answer index pointing at the same option text', () => {
        for (let i = 0; i < 200; i++) {
            const original = q();
            const shuffled = shuffleOptions(original);
            expect(shuffled.options[shuffled.answer]).toBe(original.options[original.answer]);
            expect([...shuffled.options].sort()).toEqual([...original.options].sort());
        }
    });

    it('actually moves options around', () => {
        const results = new Set();
        for (let i = 0; i < 200; i++) results.add(shuffleOptions(q()).answer);
        // A model that always answers "first option" must not be able to win.
        expect(results.size).toBeGreaterThan(1);
    });
});

describe('normalizeQuestions', () => {
    it('accepts a well-formed set', () => {
        expect(normalizeQuestions(manyValid(5))).toHaveLength(5);
    });

    it('rejects anything that is not an array', () => {
        expect(normalizeQuestions(null)).toEqual([]);
        expect(normalizeQuestions('questions')).toEqual([]);
        expect(normalizeQuestions(undefined)).toEqual([]);
    });

    it('drops an out-of-range answer index', () => {
        const set = [...manyValid(4), q({ answer: 9 })];
        expect(normalizeQuestions(set)).toHaveLength(4);
    });

    it('drops negative and non-integer answer indices', () => {
        expect(normalizeQuestions([...manyValid(4), q({ answer: -1 })])).toHaveLength(4);
        expect(normalizeQuestions([...manyValid(4), q({ answer: 1.5 })])).toHaveLength(4);
    });

    it('drops duplicate options, which make a question unanswerable', () => {
        const set = [...manyValid(4), q({ options: ['Blue', 'Blue', 'Red', 'Green'] })];
        expect(normalizeQuestions(set)).toHaveLength(4);
    });

    it('drops empty prompts and blank options', () => {
        expect(normalizeQuestions([...manyValid(4), q({ q: '   ' })])).toHaveLength(4);
        expect(normalizeQuestions([...manyValid(4), q({ options: ['A', '', 'C', 'D'] })])).toHaveLength(4);
    });

    it('drops questions with too few options to be meaningful', () => {
        expect(normalizeQuestions([...manyValid(4), q({ options: ['A', 'B'], answer: 0 })])).toHaveLength(4);
    });

    // Below the floor there is not enough signal to score on, so the caller
    // should treat the session as unscored practice instead.
    it('returns nothing when too few questions survive', () => {
        expect(normalizeQuestions(manyValid(MIN_VALID_QUESTIONS - 1))).toEqual([]);
        expect(normalizeQuestions(manyValid(MIN_VALID_QUESTIONS))).toHaveLength(MIN_VALID_QUESTIONS);
    });
});

describe('scoreQuiz', () => {
    const questions = [q({ answer: 0 }), q({ answer: 1 }), q({ answer: 2 }), q({ answer: 3 }), q({ answer: 0 })];

    it('scores a perfect and an empty run', () => {
        expect(scoreQuiz(questions, [0, 1, 2, 3, 0])).toBe(100);
        expect(scoreQuiz(questions, [1, 0, 0, 0, 1])).toBe(0);
    });

    it('gives five-question resolution rather than the old three', () => {
        expect(scoreQuiz(questions, [0, 1, 2, 3, 1])).toBe(80);
        expect(scoreQuiz(questions, [0, 1, 2, 0, 1])).toBe(60);
        expect(scoreQuiz(questions, [0, 1, 0, 0, 1])).toBe(40);
    });

    it('does not credit unanswered questions', () => {
        expect(scoreQuiz(questions, [0])).toBe(20);
    });
});
