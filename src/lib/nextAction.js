import { STEP_KINDS, nextStep } from './plans';
import { BASELINE_SAMPLES } from './stats';
import { bookProgress, isBook, nextChapterIndex } from './book';

/**
 * The one thing the dashboard suggests doing now, in priority order:
 *
 *   1. No baseline yet: every number after it needs a zero point.
 *   2. A retention check is due: it expires into a worse measurement if left.
 *   3. A plan you started has a next step: you chose that path, so follow it.
 *   4. The baseline is a single sample and you are early on: one more passage
 *      makes "+X% since baseline" mean much more.
 *   5. Otherwise a speed push, the highest-leverage drill, unless you have
 *      just done several in a row, in which case a plain measured read.
 */
export function pickNextAction({ stats, history = [], recallDue = [], plans = [], library = [] }) {
    if (stats.baselineWpm === null || stats.baselineWpm === undefined) {
        return { kind: 'baseline', title: 'Take the baseline test', detail: 'About two minutes: one passage at your natural pace, then five questions.' };
    }

    if (recallDue.length > 0) {
        const item = recallDue[0];
        return {
            kind: 'recall', id: item.id,
            title: `Retention check: ${item.title}`,
            detail: recallDue.length > 1
                ? `${recallDue.length} passages are due. Answer from memory, without re-reading.`
                : 'Answer its questions from memory, without re-reading.'
        };
    }

    const started = plans.find(p => p.completed?.length > 0 && nextStep(p));
    if (started) {
        const step = nextStep(started);
        const kind = STEP_KINDS[step.kind];
        if (kind?.view) {
            return {
                kind: 'plan', planId: started.id, step,
                title: `${started.name}: ${kind.label}`,
                detail: step.note || kind.blurb
            };
        }
    }

    const samples = stats.baselineSamples?.length ?? 0;
    if (samples > 0 && samples < BASELINE_SAMPLES && history.length < 10) {
        return {
            kind: 'baseline-more', index: samples,
            title: `Baseline passage ${samples + 1} of ${BASELINE_SAMPLES}`,
            detail: 'Your baseline is one reading so far. Another passage makes every "since baseline" number more trustworthy.'
        };
    }

    // A book you have started and not finished: pick up where you left off.
    const book = library
        .filter(i => isBook(i) && i.lastReadAt && !i.completedAt)
        .sort((a, b) => (a.lastReadAt < b.lastReadAt ? 1 : -1))[0];
    if (book) {
        const index = nextChapterIndex(book);
        return {
            kind: 'book', id: book.id, chapter: index,
            title: `Continue ${book.title}`,
            detail: `${book.chapters[index].title} · ${bookProgress(book).pct}% through the book`
        };
    }

    const lastThree = history.slice(-3);
    const pushStreak = lastThree.length === 3 && lastThree.every(s => s.mode === 'push');
    return pushStreak
        ? { kind: 'read', title: 'Read a passage', detail: 'Three pushes in a row: check the gains hold up on a plain measured read.' }
        : { kind: 'push', title: 'Speed push drill', detail: 'Over-speed passes, then a measured read of unseen text. About four minutes.' };
}
