import { describe, expect, it } from 'vitest';
import {
    PLAN_FORMAT, PLAN_MARKDOWN_MARKER, PLAN_VERSION, STARTER_PLANS, STEP_KINDS, STEP_KIND_IDS,
    createPlan, createStep, findPlan, fromMarkdown, fromShareable, isStepDone, kindFromLabel,
    migratePlans, nextStep, parsePlan, planFilename, planProgress, planSlug, removePlan,
    resetProgress, toMarkdown, toShareable, toggleStep, upsertPlan
} from './plans';

const planWith = (kinds) => createPlan({ name: 'Test', steps: kinds.map(k => createStep(k)) });

describe('step kinds', () => {
    it('every kind is either launchable or explicitly inert', () => {
        STEP_KIND_IDS.forEach(id => {
            const kind = STEP_KINDS[id];
            expect(kind.label).toBeTruthy();
            expect(kind.blurb).toBeTruthy();
            expect(kind.view === null || typeof kind.view === 'string').toBe(true);
        });
    });

    it('falls back to a sane kind rather than storing junk', () => {
        expect(createStep('nonsense').kind).toBe('read');
    });

    it('gives every step a unique id', () => {
        const ids = Array.from({ length: 50 }, () => createStep('read').id);
        expect(new Set(ids).size).toBe(50);
    });
});

describe('createPlan', () => {
    it('always has at least one step, so a new plan is never empty', () => {
        expect(createPlan().steps.length).toBeGreaterThan(0);
    });

    it('starts with no progress', () => {
        expect(createPlan().completed).toEqual([]);
    });

    it('does not accept an untitled blank name', () => {
        expect(createPlan({ name: '' }).name).toBe('Untitled plan');
    });
});

describe('collection operations', () => {
    it('adds, finds, updates in place, and removes', () => {
        const plan = createPlan({ name: 'Mine' });
        let plans = upsertPlan([], plan);
        expect(findPlan(plans, plan.id).name).toBe('Mine');

        plans = upsertPlan(plans, { ...plan, name: 'Renamed' });
        expect(plans).toHaveLength(1);
        expect(findPlan(plans, plan.id).name).toBe('Renamed');

        expect(removePlan(plans, plan.id)).toHaveLength(0);
        expect(findPlan([], 'nope')).toBeNull();
    });
});

describe('progress', () => {
    it('ticks and unticks a step', () => {
        const plan = planWith(['read', 'chunk']);
        const id = plan.steps[0].id;
        expect(isStepDone(plan, id)).toBe(false);
        const after = toggleStep(plan, id);
        expect(isStepDone(after, id)).toBe(true);
        expect(isStepDone(toggleStep(after, id), id)).toBe(false);
    });

    it('reports percentage complete', () => {
        const plan = planWith(['read', 'chunk', 'schulte', 'push']);
        expect(planProgress(plan)).toBe(0);
        expect(planProgress(toggleStep(plan, plan.steps[0].id))).toBe(25);
    });

    // Deleting a step must not leave the plan reporting more than 100%.
    it('ignores ticks belonging to steps that no longer exist', () => {
        const plan = planWith(['read', 'chunk']);
        const stale = { ...plan, completed: [plan.steps[0].id, 'deleted-step', 'another-ghost'] };
        expect(planProgress(stale)).toBe(50);
    });

    it('points at the first unfinished step', () => {
        const plan = planWith(['read', 'chunk']);
        expect(nextStep(plan).id).toBe(plan.steps[0].id);
        const after = toggleStep(plan, plan.steps[0].id);
        expect(nextStep(after).id).toBe(plan.steps[1].id);
    });

    it('has no next step once everything is done', () => {
        let plan = planWith(['read']);
        plan = toggleStep(plan, plan.steps[0].id);
        expect(nextStep(plan)).toBeNull();
        expect(planProgress(plan)).toBe(100);
    });

    it('can be started over', () => {
        const plan = toggleStep(planWith(['read', 'chunk']), 'x');
        expect(resetProgress(plan).completed).toEqual([]);
    });
});

describe('sharing', () => {
    const mine = createPlan({
        name: 'My plan', goal: 'Go faster', notes: 'Tips here', author: 'Me',
        steps: [createStep('push', 'warm up'), createStep('chunk', 'then this')]
    });

    it('stamps the file so it can be recognised', () => {
        const shared = toShareable(mine);
        expect(shared.format).toBe(PLAN_FORMAT);
        expect(shared.version).toBe(PLAN_VERSION);
    });

    // Someone else's ticks are meaningless to you.
    it('carries the content but not the progress', () => {
        const shared = toShareable(toggleStep(mine, mine.steps[0].id));
        expect(shared.steps).toHaveLength(2);
        expect(shared.completed).toBeUndefined();
        expect(JSON.stringify(shared)).not.toContain(mine.steps[0].id);
    });

    it('round-trips name, goal, notes, author and steps', () => {
        const restored = fromShareable(JSON.parse(JSON.stringify(toShareable(mine))));
        expect(restored).toMatchObject({ name: 'My plan', goal: 'Go faster', notes: 'Tips here', author: 'Me' });
        expect(restored.steps.map(s => s.kind)).toEqual(['push', 'chunk']);
        expect(restored.steps.map(s => s.note)).toEqual(['warm up', 'then this']);
    });

    it('gives an imported plan a fresh id and empty progress', () => {
        const restored = fromShareable(JSON.parse(JSON.stringify(toShareable(mine))));
        expect(restored.id).not.toBe(mine.id);
        expect(restored.completed).toEqual([]);
        expect(restored.steps[0].id).not.toBe(mine.steps[0].id);
    });

    it('explains what is wrong instead of importing rubbish', () => {
        expect(() => fromShareable(null)).toThrow(/does not contain a training plan/);
        expect(() => fromShareable([1, 2])).toThrow(/does not contain a training plan/);
        expect(() => fromShareable({ some: 'json' })).toThrow(/not a Speed AI training plan/);
        expect(() => fromShareable({ format: PLAN_FORMAT, version: PLAN_VERSION + 1 })).toThrow(/newer version/);
        expect(() => fromShareable({ format: PLAN_FORMAT, version: 1, steps: [] })).toThrow(/no usable steps/);
        expect(() => fromShareable({ format: PLAN_FORMAT, version: 1, steps: [{ kind: 'teleport' }] })).toThrow(/no usable steps/);
    });

    it('drops unknown step kinds but keeps the rest', () => {
        const restored = fromShareable({
            format: PLAN_FORMAT, version: 1, name: 'Mixed',
            steps: [{ kind: 'push' }, { kind: 'teleport' }, { kind: 'chunk' }]
        });
        expect(restored.steps.map(s => s.kind)).toEqual(['push', 'chunk']);
    });

    it('builds a safe filename from any name', () => {
        expect(planFilename({ name: 'My Plan: Week 1!' })).toBe('my-plan-week-1.plan.md');
        expect(planFilename({ name: '' })).toBe('training-plan.plan.md');
        expect(planFilename({ name: '???' })).toBe('training-plan.plan.md');
        expect(planFilename({ name: 'Week one' }, 'json')).toBe('week-one.plan.json');
        expect(planSlug({ name: 'Week One' })).toBe('week-one');
    });
});

describe('migratePlans', () => {
    it('round-trips through JSON', () => {
        const plans = [createPlan({ name: 'A' }), createPlan({ name: 'B' })];
        expect(migratePlans(JSON.parse(JSON.stringify(plans)))).toHaveLength(2);
    });

    it('survives junk', () => {
        expect(migratePlans(null)).toEqual([]);
        expect(migratePlans('nope')).toEqual([]);
        expect(migratePlans([null, { id: 'x' }, 42])).toEqual([]);
    });

    it('drops a plan whose steps were all invalid', () => {
        expect(migratePlans([{ id: 'p', steps: [{ kind: 'teleport' }] }])).toEqual([]);
    });

    it('keeps progress across a reload', () => {
        let plan = planWith(['read', 'chunk']);
        plan = toggleStep(plan, plan.steps[0].id);
        const [restored] = migratePlans(JSON.parse(JSON.stringify([plan])));
        expect(restored.completed).toHaveLength(1);
        expect(planProgress(restored)).toBe(50);
    });
});

describe('starter plans', () => {
    it('every built-in plan imports cleanly', () => {
        STARTER_PLANS.forEach(starter => {
            const plan = createPlan(starter);
            expect(plan.steps.length).toBe(starter.steps.length);
            expect(planProgress(plan)).toBe(0);
        });
    });

    it('only uses step kinds the app can run', () => {
        STARTER_PLANS.forEach(starter => {
            starter.steps.forEach(step => expect(STEP_KIND_IDS).toContain(step.kind));
        });
    });

    it('every step explains itself', () => {
        STARTER_PLANS.forEach(starter => {
            starter.steps.forEach(step => expect(step.note.length).toBeGreaterThan(10));
        });
    });
});


describe('kindFromLabel', () => {
    it('resolves every human label and every raw id', () => {
        STEP_KIND_IDS.forEach(id => {
            expect(kindFromLabel(STEP_KINDS[id].label)).toBe(id);
            expect(kindFromLabel(id)).toBe(id);
        });
    });

    // Anyone editing the file by hand will not match our capitalisation.
    it('does not care about case, spacing or punctuation', () => {
        expect(kindFromLabel('speed push drill')).toBe('push');
        expect(kindFromLabel('  SPEED-PUSH  DRILL ')).toBe('push');
        expect(kindFromLabel('Chunk Perception')).toBe('chunk');
    });

    it('returns null for anything it does not know', () => {
        expect(kindFromLabel('teleport')).toBeNull();
        expect(kindFromLabel('')).toBeNull();
        expect(kindFromLabel(null)).toBeNull();
    });
});

describe('toMarkdown', () => {
    const plan = createPlan({
        name: 'Week one', goal: 'Find a baseline', notes: 'Take it slowly.\nFifteen minutes a day.',
        author: 'Me', steps: [createStep('baseline', 'Normal pace.'), createStep('note', 'Rest.')]
    });
    const md = toMarkdown(plan);

    it('writes a readable document, not a serialised object', () => {
        expect(md).toMatch(/^# Week one/);
        expect(md).toContain('> Find a baseline');
        expect(md).toContain('**Author:** Me');
        expect(md).toContain('Take it slowly.');
        expect(md).toContain('## Steps');
        expect(md).toContain('1. **Baseline test** — Normal pace.');
        expect(md).toContain('2. **Note or rest** — Rest.');
    });

    it('stamps itself so a reader knows what it is', () => {
        expect(md).toContain(PLAN_MARKDOWN_MARKER);
    });

    // Progress is personal; a shared plan carries the work, not the ticks.
    it('carries no progress', () => {
        const ticked = toggleStep(plan, plan.steps[0].id);
        expect(toMarkdown(ticked)).toBe(md);
        expect(toMarkdown(ticked)).not.toContain(plan.steps[0].id);
    });

    it('survives a step with no note', () => {
        const bare = createPlan({ name: 'Bare', steps: [createStep('chunk', '')] });
        expect(toMarkdown(bare)).toContain('1. **Chunk Perception**');
        expect(fromMarkdown(toMarkdown(bare)).steps[0].kind).toBe('chunk');
    });
});

describe('fromMarkdown', () => {
    const round = (plan) => fromMarkdown(toMarkdown(plan));

    it('round-trips everything that is shared', () => {
        const plan = createPlan({
            name: 'Week one', goal: 'Find a baseline', notes: 'Take it slowly.',
            author: 'Me', steps: [createStep('baseline', 'Normal pace.'), createStep('chunk', 'Two runs.')]
        });
        const back = round(plan);
        expect(back).toMatchObject({ name: 'Week one', goal: 'Find a baseline', notes: 'Take it slowly.', author: 'Me' });
        expect(back.steps.map(s => s.kind)).toEqual(['baseline', 'chunk']);
        expect(back.steps.map(s => s.note)).toEqual(['Normal pace.', 'Two runs.']);
    });

    it('gives the import a fresh id and empty progress', () => {
        const plan = createPlan({ name: 'Mine', steps: [createStep('push', 'go')] });
        const back = round(toggleStep(plan, plan.steps[0].id));
        expect(back.id).not.toBe(plan.id);
        expect(back.steps[0].id).not.toBe(plan.steps[0].id);
        expect(back.completed).toEqual([]);
    });

    it('round-trips every starter plan', () => {
        STARTER_PLANS.forEach(starter => {
            const plan = createPlan({ ...starter, steps: starter.steps.map(s => createStep(s.kind, s.note)) });
            const back = round(plan);
            expect(back.steps.map(s => s.kind)).toEqual(plan.steps.map(s => s.kind));
            expect(back.steps.map(s => s.note)).toEqual(plan.steps.map(s => s.note));
            expect(back.notes).toBe(plan.notes);
            expect(back.goal).toBe(plan.goal);
        });
    });

    // The point of Markdown is that a person can write one by hand.
    it('reads a plan written from scratch, with no marker and no ceremony', () => {
        const plan = fromMarkdown(`# My own plan

> Get faster at technical reading

1. **Speed push drill** - warm up first
2. **Chunk Perception** - two runs
3. **Note or rest** - stop if your eyes ache
`);
        expect(plan.name).toBe('My own plan');
        expect(plan.goal).toBe('Get faster at technical reading');
        expect(plan.steps.map(s => s.kind)).toEqual(['push', 'chunk', 'note']);
        expect(plan.steps[0].note).toBe('warm up first');
    });

    it('accepts bullets and checkboxes as well as numbers', () => {
        const plan = fromMarkdown(`# Bullets

## Steps

- [x] **Chunk Perception** — already did this one
- [ ] **Schulte Table** — still to do
* **Target Scanning** — plain bullet
`);
        expect(plan.steps.map(s => s.kind)).toEqual(['chunk', 'schulte', 'scanning']);
        // A tick in a file someone sent you says nothing about your progress.
        expect(plan.completed).toEqual([]);
        expect(plan.steps[0].note).toBe('already did this one');
    });

    it('takes the kind id when the label was edited away', () => {
        const plan = fromMarkdown('# Ids\n\n1. **push** — by id\n2. **schulte** — also by id');
        expect(plan.steps.map(s => s.kind)).toEqual(['push', 'schulte']);
    });

    it('skips steps it does not recognise rather than failing on them', () => {
        const plan = fromMarkdown('# Mixed\n\n1. **Speed push drill** — real\n2. **Interpretive dance** — not real\n3. **Schulte Table** — real');
        expect(plan.steps.map(s => s.kind)).toEqual(['push', 'schulte']);
    });

    it('keeps a multi-line goal together', () => {
        const plan = fromMarkdown('# Q\n\n> line one\n> line two\n\n1. **Read a passage** — x');
        expect(plan.goal).toBe('line one line two');
    });

    // Without a Steps heading the whole document is scanned for steps, so the
    // lines that became steps must not be echoed back as notes too.
    it('does not repeat the steps in the notes when there is no heading', () => {
        const plan = fromMarkdown(`# Scratch plan

> Written by hand

- [ ] **Chunk Perception** - warm up
- [x] **Schulte Table** - two runs
`);
        expect(plan.steps).toHaveLength(2);
        expect(plan.notes).toBe('');
    });

    // An unrecognised line is not a step, so it is prose and must be kept.
    it('keeps a line it could not read as a step', () => {
        const plan = fromMarkdown('# Q\n\n1. **Chunk Perception** — real\n2. **Interpretive dance** — not a drill');
        expect(plan.steps).toHaveLength(1);
        expect(plan.notes).toContain('Interpretive dance');
    });

    it('treats leftover prose as notes', () => {
        const plan = fromMarkdown('# Q\n\n> goal\n\nSome advice here.\n\nAnd more.\n\n## Steps\n\n1. **Read a passage** — x');
        expect(plan.notes).toBe('Some advice here.\n\nAnd more.');
    });

    // Quoting the app inside your own notes must not break the parse.
    it('uses the last Steps heading, so the words can appear in the notes', () => {
        const plan = fromMarkdown(`# Q

I copied this from the ## Steps section of another plan.

## Steps

1. **Chunk Perception** — the only real step
`);
        expect(plan.steps).toHaveLength(1);
        expect(plan.notes).toContain('another plan');
    });

    it('names the problem instead of importing nothing', () => {
        expect(() => fromMarkdown('')).toThrow(/nothing to import/i);
        expect(() => fromMarkdown(null)).toThrow(/nothing to import/i);
        expect(() => fromMarkdown('# Just a title\n\nSome prose and no list.')).toThrow(/No steps found/);
        // The message has to say what a step looks like.
        expect(() => fromMarkdown('# x')).toThrow(/Speed push drill/);
    });

    it('falls back to a name rather than an untitled plan', () => {
        expect(fromMarkdown('1. **Chunk Perception** — x').name).toBe('Imported plan');
    });

    it('handles Windows line endings', () => {
        const plan = fromMarkdown('# CRLF\r\n\r\n> goal\r\n\r\n1. **Schulte Table** — note\r\n');
        expect(plan.name).toBe('CRLF');
        expect(plan.steps[0].note).toBe('note');
    });
});

describe('parsePlan', () => {
    const plan = createPlan({ name: 'Either way', steps: [createStep('push', 'go')] });

    it('reads the Markdown format', () => {
        expect(parsePlan(toMarkdown(plan)).name).toBe('Either way');
    });

    // Files exported by earlier builds still have to open.
    it('still reads the JSON that older builds wrote', () => {
        expect(parsePlan(JSON.stringify(toShareable(plan))).name).toBe('Either way');
    });

    it('explains a broken JSON file as JSON, not as Markdown', () => {
        expect(() => parsePlan('{"format": "speed-ai')).toThrow(/did not parse/);
        expect(() => parsePlan(JSON.stringify({ nope: 1 }))).toThrow(/not a Speed AI training plan/);
    });

    it('refuses an empty paste', () => {
        expect(() => parsePlan('   ')).toThrow(/nothing to import/i);
        expect(() => parsePlan(null)).toThrow(/nothing to import/i);
    });
});
