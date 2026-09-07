import { todayKey } from './stats';
import { finiteOr } from './num';

// A training plan is an ordered list of things to do, written by you and
// shareable as a file. The app deliberately does not know better than you what
// your week should look like — it only knows how to run each step and remember
// which ones you finished.

export const PLAN_FORMAT = 'speed-ai-training-plan';
export const PLAN_VERSION = 1;
const MAX_PLANS = 40;
const MAX_STEPS = 60;

/**
 * Every step kind maps to something the app can actually launch, plus `note`
 * for rest days and written instructions that need no action.
 */
export const STEP_KINDS = {
    baseline: { label: 'Baseline test', view: 'dashboard', blurb: 'Re-measure your natural pace' },
    push: { label: 'Speed push drill', view: 'library', blurb: 'Over-speed passes, then a measured read' },
    read: { label: 'Read a passage', view: 'library', blurb: 'Any passage, generated or your own' },
    chunk: { label: 'Chunk Perception', view: 'tools', blurb: 'Words taken in per fixation' },
    schulte: { label: 'Schulte Table', view: 'tools', blurb: 'Attention spread across a grid' },
    peripheral: { label: 'Peripheral Expansion', view: 'tools', blurb: 'Perceptual span threshold' },
    scanning: { label: 'Target Scanning', view: 'tools', blurb: 'Visual search speed' },
    note: { label: 'Note or rest', view: null, blurb: 'Something to read or remember, no action' }
};

export const STEP_KIND_IDS = Object.keys(STEP_KINDS);

const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const createStep = (kind = 'read', note = '') => ({
    id: newId('step'),
    kind: STEP_KIND_IDS.includes(kind) ? kind : 'read',
    note: String(note)
});

export function createPlan({ name = 'Untitled plan', goal = '', notes = '', author = '', steps = [] } = {}) {
    return {
        id: newId('plan'),
        name: String(name).slice(0, 120) || 'Untitled plan',
        goal: String(goal).slice(0, 400),
        notes: String(notes).slice(0, 4000),
        author: String(author).slice(0, 120),
        createdAt: todayKey(),
        steps: steps.length ? steps.slice(0, MAX_STEPS) : [createStep('push', 'Warm up with the built-in drill.')],
        completed: []
    };
}

export const upsertPlan = (plans, plan) => {
    const index = plans.findIndex(p => p.id === plan.id);
    if (index === -1) return [plan, ...plans].slice(0, MAX_PLANS);
    const next = [...plans];
    next[index] = plan;
    return next;
};

export const removePlan = (plans, id) => plans.filter(p => p.id !== id);
export const findPlan = (plans, id) => plans.find(p => p.id === id) ?? null;

export const isStepDone = (plan, stepId) => plan.completed.includes(stepId);

export function toggleStep(plan, stepId) {
    const done = isStepDone(plan, stepId);
    return {
        ...plan,
        completed: done ? plan.completed.filter(id => id !== stepId) : [...plan.completed, stepId]
    };
}

export const resetProgress = (plan) => ({ ...plan, completed: [] });

/** Completed steps as a percentage, ignoring ticks left over from deleted steps. */
export function planProgress(plan) {
    if (!plan.steps.length) return 0;
    const live = plan.completed.filter(id => plan.steps.some(s => s.id === id));
    return Math.round((live.length / plan.steps.length) * 100);
}

/** The first unfinished step, or null when the plan is complete. */
export const nextStep = (plan) => plan.steps.find(step => !isStepDone(plan, step.id)) ?? null;

// --- Sharing ---------------------------------------------------------------

/** Progress is personal, so a shared plan carries the steps but not the ticks. */
export const toShareable = (plan) => ({
    format: PLAN_FORMAT,
    version: PLAN_VERSION,
    name: plan.name,
    goal: plan.goal,
    notes: plan.notes,
    author: plan.author,
    steps: plan.steps.map(({ kind, note }) => ({ kind, note }))
});

export const planSlug = (plan) =>
    (plan.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'training-plan';

export const planFilename = (plan, extension = 'md') => `${planSlug(plan)}.plan.${extension}`;

// --- Markdown --------------------------------------------------------------

// Markdown is the share format because a plan is mostly prose: it reads fine in
// any editor, pastes into a message intact, and someone can write one by hand
// without knowing anything about this app's JSON. The marker below is a hint
// for humans, not a requirement — anything with a title and a recognisable
// step list will import.

export const PLAN_MARKDOWN_MARKER = `<!-- ${PLAN_FORMAT} v${PLAN_VERSION} -->`;

const normalizeLabel = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Both the human label and the raw kind id resolve, so hand-edits survive. */
const KIND_BY_LABEL = new Map(
    STEP_KIND_IDS.flatMap(id => [
        [normalizeLabel(id), id],
        [normalizeLabel(STEP_KINDS[id].label), id]
    ])
);

export const kindFromLabel = (text) => KIND_BY_LABEL.get(normalizeLabel(text)) ?? null;

export function toMarkdown(plan) {
    const lines = [`# ${plan.name}`, ''];
    if (plan.goal) lines.push(`> ${plan.goal}`, '');
    if (plan.author) lines.push(`**Author:** ${plan.author}`, '');
    if (plan.notes) lines.push(plan.notes.trim(), '');

    lines.push('## Steps', '');
    plan.steps.forEach((step, index) => {
        // Notes collapse to one line: a step is a list item, and a hard wrap
        // inside one would come back as a separate unparseable line.
        const note = step.note.trim().replace(/\s+/g, ' ');
        lines.push(`${index + 1}. **${STEP_KINDS[step.kind].label}**${note ? ` — ${note}` : ''}`);
    });

    lines.push('', PLAN_MARKDOWN_MARKER, '');
    return lines.join('\n');
}

// Numbered or bulleted, with an optional checkbox that is read and discarded —
// people tick things off in their editor, and progress is not shared anyway.
const STEP_LINE = /^\s*(?:\d+[.)]|[-*+])\s*(?:\[[ xX]\]\s*)?\*\*(.+?)\*\*\s*(?:[—–:-]\s*)?(.*)$/;

/**
 * Reads a plan out of Markdown. Deliberately forgiving about everything except
 * the step list, since that is the only part the app has to understand.
 */
export function fromMarkdown(text) {
    if (typeof text !== 'string' || !text.trim()) {
        throw new Error('There is nothing to import.');
    }

    const body = text.replace(/\r\n?/g, '\n');
    // The last "## Steps" wins, so the words appearing inside someone's notes
    // cannot swallow the real list.
    const stepsAt = body.toLowerCase().lastIndexOf('\n## steps');
    const head = stepsAt === -1 ? body : body.slice(0, stepsAt);
    const tail = stepsAt === -1 ? body : body.slice(stepsAt);

    const steps = [];
    tail.split('\n').forEach(line => {
        const match = line.match(STEP_LINE);
        if (!match) return;
        const kind = kindFromLabel(match[1]);
        if (kind) steps.push(createStep(kind, match[2].trim()));
    });

    if (!steps.length) {
        throw new Error(
            `No steps found. Each one needs its own line, like "1. **${STEP_KINDS.push.label}** — what to focus on".`
        );
    }

    let name = '';
    let goal = '';
    let author = '';
    const noteLines = [];

    head.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed.length && !noteLines.length) return;
        if (trimmed.startsWith('<!--')) return;

        const title = trimmed.match(/^#\s+(.*)$/);
        if (title && !name) { name = title[1].trim(); return; }

        const quoted = trimmed.match(/^>\s*(.*)$/);
        if (quoted) { goal = goal ? `${goal} ${quoted[1].trim()}`.trim() : quoted[1].trim(); return; }

        const by = trimmed.match(/^(?:\*\*)?author:?(?:\*\*)?:?\s*(.+)$/i);
        if (by && !author) { author = by[1].trim(); return; }

        // A plan with no "## Steps" heading is read head-to-toe, so the lines
        // that became steps have to be kept out of the notes as well. Only
        // then: below a heading the notes are prose, and a line there that
        // merely looks like a step is text the writer meant to keep.
        if (stepsAt === -1) {
            const asStep = trimmed.match(STEP_LINE);
            if (asStep && kindFromLabel(asStep[1])) return;
        }

        noteLines.push(line);
    });

    return createPlan({
        name: name || 'Imported plan',
        goal,
        author,
        notes: noteLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
        steps
    });
}

/**
 * Reads whatever the user handed over — a .md file, pasted text, or the JSON
 * that earlier builds exported.
 */
export function parsePlan(raw) {
    const text = String(raw ?? '').trim();
    if (!text) throw new Error('There is nothing to import.');

    if (text.startsWith('{')) {
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new Error('That looks like JSON, but it did not parse.');
        }
        return fromShareable(parsed);
    }

    return fromMarkdown(text);
}

/**
 * Reads a shared plan file. Throws with a readable message rather than
 * producing a half-valid plan, and always returns a fresh id and empty
 * progress so importing never collides with something you already have.
 */
export function fromShareable(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('That file does not contain a training plan.');
    }
    if (parsed.format !== PLAN_FORMAT) {
        throw new Error('That JSON is not a Speed AI training plan.');
    }
    if (finiteOr(parsed.version, 0) > PLAN_VERSION) {
        throw new Error(`That plan was written by a newer version (v${parsed.version}). Update the app first.`);
    }

    const steps = (Array.isArray(parsed.steps) ? parsed.steps : [])
        .filter(s => s && STEP_KIND_IDS.includes(s.kind))
        .slice(0, MAX_STEPS)
        .map(s => createStep(s.kind, typeof s.note === 'string' ? s.note : ''));

    if (!steps.length) throw new Error('That plan has no usable steps in it.');

    return createPlan({
        name: typeof parsed.name === 'string' ? parsed.name : 'Imported plan',
        goal: typeof parsed.goal === 'string' ? parsed.goal : '',
        notes: typeof parsed.notes === 'string' ? parsed.notes : '',
        author: typeof parsed.author === 'string' ? parsed.author : '',
        steps
    });
}

export function migratePlans(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(p => p && typeof p.id === 'string' && Array.isArray(p.steps))
        .slice(0, MAX_PLANS)
        .map(p => ({
            id: p.id,
            name: typeof p.name === 'string' ? p.name : 'Untitled plan',
            goal: typeof p.goal === 'string' ? p.goal : '',
            notes: typeof p.notes === 'string' ? p.notes : '',
            author: typeof p.author === 'string' ? p.author : '',
            createdAt: typeof p.createdAt === 'string' ? p.createdAt : todayKey(),
            steps: p.steps
                .filter(s => s && STEP_KIND_IDS.includes(s.kind))
                .slice(0, MAX_STEPS)
                .map(s => ({ id: typeof s.id === 'string' ? s.id : newId('step'), kind: s.kind, note: typeof s.note === 'string' ? s.note : '' })),
            completed: Array.isArray(p.completed) ? p.completed.filter(id => typeof id === 'string') : []
        }))
        .filter(p => p.steps.length > 0);
}

// --- Starter plans ---------------------------------------------------------

/**
 * Examples rather than prescriptions: enough to show the shape of a plan and
 * give someone a first week, expected to be edited rather than followed.
 */
export const STARTER_PLANS = [
    {
        name: 'First week',
        goal: 'Establish a baseline and get used to every mode.',
        notes: 'One sitting a day, about fifteen minutes. Do not chase speed this week — the point is a trustworthy starting number and knowing your way around.',
        author: 'Built in',
        steps: [
            { kind: 'baseline', note: 'Read at your genuinely normal pace. Do not push.' },
            { kind: 'note', note: 'Open Reading Setup and tune the type until a line feels like one comfortable sweep. Everything later is measured under these settings.' },
            { kind: 'push', note: 'Run the built-in drill so you have felt the over-speed passes once.' },
            { kind: 'chunk', note: 'Chunk Perception. Note the number; it is your starting width.' },
            { kind: 'read', note: 'Import something you actually need to read. Paced mode, no quiz.' },
            { kind: 'schulte', note: 'Two runs. Keep your eyes on the centre square.' },
            { kind: 'note', note: 'Rest day. Read a book normally and notice whether you regress less.' }
        ]
    },
    {
        name: 'Chunk width focus',
        goal: 'Raise words-per-fixation, which multiplies straight into WPM.',
        notes: 'Short and repetitive on purpose. Chunk Perception every session, because width is the constraint that actually caps reading speed.',
        author: 'Built in',
        steps: [
            { kind: 'chunk', note: 'Warm up. Do not rush the choice — accuracy over speed here.' },
            { kind: 'push', note: 'Speed push drill. Notice the 3x pass feeling less chaotic over time.' },
            { kind: 'chunk', note: 'Second run, after the push. Usually a word wider.' },
            { kind: 'note', note: 'If your best width went up, raise your target speed by 25 in Settings.' }
        ]
    }
];
