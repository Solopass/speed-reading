import { describe, expect, it } from 'vitest';
import { pickNextAction } from './nextAction';
import { DEFAULT_STATS } from './stats';
import { createPlan, createStep } from './plans';

const withBaseline = { ...DEFAULT_STATS, baselineWpm: 250, baselineSamples: [{ wpm: 250 }, { wpm: 250 }, { wpm: 250 }] };

describe('pickNextAction', () => {
    it('asks for a baseline first', () => {
        expect(pickNextAction({ stats: DEFAULT_STATS }).kind).toBe('baseline');
    });

    it('puts a due retention check ahead of everything else', () => {
        const a = pickNextAction({ stats: withBaseline, recallDue: [{ id: 'p1', title: 'Aqueducts' }] });
        expect(a).toMatchObject({ kind: 'recall', id: 'p1' });
    });

    it('follows the next step of a plan already in progress', () => {
        const plan = createPlan({ name: 'Week 1', steps: [createStep('push'), createStep('schulte')] });
        const started = { ...plan, completed: [plan.steps[0].id] };
        const a = pickNextAction({ stats: withBaseline, plans: [plan, started] });
        expect(a.kind).toBe('plan');
        expect(a.step.kind).toBe('schulte');
    });

    it('ignores plans nobody has started', () => {
        const plan = createPlan({ steps: [createStep('schulte')] });
        expect(pickNextAction({ stats: withBaseline, plans: [plan] }).kind).toBe('push');
    });

    it('offers another baseline passage early on', () => {
        const one = { ...withBaseline, baselineSamples: [{ wpm: 250 }] };
        expect(pickNextAction({ stats: one })).toMatchObject({ kind: 'baseline-more', index: 1 });
        const later = Array.from({ length: 10 }, () => ({ mode: 'rsvp' }));
        expect(pickNextAction({ stats: one, history: later }).kind).toBe('push');
    });

    it('suggests a plain read after three pushes in a row', () => {
        const pushes = [{ mode: 'push' }, { mode: 'push' }, { mode: 'push' }];
        expect(pickNextAction({ stats: withBaseline, history: pushes }).kind).toBe('read');
    });
});

describe('books in the next action', () => {
    it('offers to continue the most recently read unfinished book', async () => {
        const { createBook } = await import('./book');
        const words = (n) => Array.from({ length: n }, () => 'w').join(' ');
        const book = { ...createBook({ id: 'b1', title: 'Novel', chapters: [{ title: 'One', text: words(300) }, { title: 'Two', text: words(300) }] }), lastReadAt: '2026-01-02', currentChapter: 1 };
        const unopened = createBook({ id: 'b2', title: 'Unopened', chapters: [{ title: 'X', text: words(300) }] });
        const a = pickNextAction({ stats: withBaseline, library: [unopened, book] });
        expect(a).toMatchObject({ kind: 'book', id: 'b1', chapter: 1, title: 'Continue Novel' });
        expect(pickNextAction({ stats: withBaseline, library: [{ ...book, completedAt: '2026-01-03' }] }).kind).toBe('push');
    });
});
