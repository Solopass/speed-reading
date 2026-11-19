import { daysBetween, todayKey } from './stats';

// Vocabulary trainer. Unfamiliar words force extra fixations, so recognising
// them on sight is a direct speed lever. Candidates come from passages you
// have actually read, not a generic list: a word is a candidate when it is
// long, appears rarely across your library, is not a proper noun, and is not
// on the list of common long words below.

export const MIN_WORD_LENGTH = 8;
export const MAX_CANDIDATES = 40;
export const MAX_ITEMS = 500;

// Common English words of eight letters or more that a long-word filter would
// otherwise surface. Not exhaustive; anything it misses can be skipped.
const COMMON = new Set(`
absolutely according actually addition additional administration afternoon against already although
american analysis announced anything anywhere apparently appropriate approach approximately argument
attention available background basically beautiful becoming beginning believed benefits birthday
boundaries breakfast brothers building business campaign candidate capacity carefully categories
celebrate centuries certainly challenge challenges changing character children chocolate christmas
churches citizens classroom clothing collection colleague colleagues commercial committee common
communication communities community companies comparison competition complete completely computer
concerned condition conditions conference confidence connection consider considered consistent
constant construction consumer contains continue continued contract contrast control conversation
countries countryside currently customer customers daughter deadline december decision decisions
definitely delivered department described description designed detailed determine developed
developing development difference different difficult directly director discovered discussion
distance distribution division document downtown dramatic earliest economic economy education
effective efficient electric electricity elements elsewhere emergency employee employees encourage
engineering entirely environment equipment especially establish established estimate evening
eventually everybody everyone everything evidence exactly examples excellent exchange exercise
existing expected expensive experience experienced experiment explained expression extremely
facilities families favorite favourite february feelings festival financial following football
foreign forward freedom friendly friends frequently function generally generation government
graduate grandfather grandmother greatest guidelines happened happening hardware headline
headquarters hospital household however hundreds identify immediately important importance improve
improvement included including increase increased increasing independent individual individuals
industrial industry influence information instance instead institution interest interested
interesting international interview introduced investigation investment involved january keyboard
knowledge landscape language laughing launched leadership learning location magazine maintain
majority management marriage material materials meanwhile measures medicine membership mentioned
military millions minister minority minutes mountain mountains movement national naturally necessary
negative neighborhood neighbourhood newspaper normally northern november obviously occasion
official officials operating operation operations opinion opportunity organization organisation
original otherwise overseas painting particular particularly passenger patients performance perhaps
permanent personal personality perspective photograph physical planning platform political politics
population position positive possible potential practice pregnant preparation prepared presence
president pressure previous previously primarily principal principle priority prisoner probably
problems procedure process produced producer products professional professor profile program
programme progress project projects property proposal protection provided provides publication
published purchase qualified quarter question questions quickly reaction recently recognize
recognise recommend recording reduction reference regarding regional regular relationship
relatively religious remained remember reported representative republican requirements research researcher
resident residents resources response responsibility responsible restaurant revealed sandwich
saturday schedule scientific scientists secretary security selected sentence september seriously
services settlement shopping situation software solution somebody someone something sometimes
somewhere southern specific spending standard standards statement stations strategy strength
structure students studying subsequently suddenly suggested sunday supported surprise surprised
surrounding survival teaching technical technology telephone television temperature terrible
territory themselves therefore thinking thousand thousands throughout thursday together tomorrow
tonight training transfer transport treatment tuesday ultimately understand understanding
undertaken university unusual valuable variety vehicle vehicles version violence visitors
weakness wednesday weekend whatever whenever wherever whether withdrawal without wonderful
yesterday yourself yourselves
`.split(/\s+/).filter(Boolean));

const WORD = /[A-Za-z][A-Za-z'-]*[A-Za-z]/g;

/** Splits text into sentences, roughly, for the context shown beside a word. */
function sentences(text) {
    return text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [];
}

const passageText = (entry) => [entry.text, entry.sectionA, entry.sectionB].filter(Boolean).join(' ');

/**
 * Uncommon words from your library, rarest and longest first, each with the
 * sentence it first appeared in. Words already saved or dismissed are skipped.
 */
export function candidateWords(library, exclude = new Set(), limit = MAX_CANDIDATES) {
    const seen = new Map();
    for (const entry of library) {
        const text = passageText(entry);
        if (!text) continue;
        for (const sentence of sentences(text)) {
            const trimmed = sentence.trim();
            const tokens = trimmed.match(WORD) ?? [];
            tokens.forEach((token, i) => {
                const word = token.toLowerCase().replace(/^'+|'+$/g, '');
                if (word.length < MIN_WORD_LENGTH || word.includes('-') || COMMON.has(word) || exclude.has(word)) return;
                if (isCommon(word)) return;
                const capitalised = token[0] !== token[0].toLowerCase();
                const record = seen.get(word) ?? { word, count: 0, lowercase: 0, midCapital: 0, context: trimmed, source: entry.title };
                record.count += 1;
                // A capital at the start of a sentence says nothing. Anywhere
                // else it marks a name, so a word only ever seen capitalised
                // mid-sentence is treated as a proper noun and dropped below.
                if (!capitalised) record.lowercase += 1;
                else if (i > 0) record.midCapital += 1;
                seen.set(word, record);
            });
        }
    }
    return [...seen.values()]
        .filter(r => r.lowercase > 0 || r.midCapital === 0)
        .sort((a, b) => a.count - b.count || b.word.length - a.word.length || a.word.localeCompare(b.word))
        .slice(0, limit)
        .map(({ word, count, context, source }) => ({ word, count, context, source }));
}

/** Common words and their regular inflections (plurals, -ed, -ing, -ly). */
function isCommon(word) {
    if (COMMON.has(word)) return true;
    const stems = [
        word.replace(/s$/, ''), word.replace(/es$/, ''), word.replace(/ies$/, 'y'),
        word.replace(/ed$/, ''), word.replace(/ed$/, 'e'), word.replace(/ing$/, ''), word.replace(/ing$/, 'e'),
        word.replace(/ly$/, ''), word.replace(/ers?$/, ''), word.replace(/ers?$/, 'e')
    ];
    return stems.some(stem => stem !== word && COMMON.has(stem));
}

// --- Saved words and review ------------------------------------------------

/** Days until the next review after each successful one. */
export const REVIEW_INTERVALS = [1, 3, 7, 16, 35, 80];

export function createVocabItem({ word, context = '', source = '', note = '' }, today = todayKey()) {
    return {
        id: `v-${word.toLowerCase()}`,
        word: word.toLowerCase(),
        context, source, note,
        addedAt: today,
        due: today,
        step: 0,          // index into REVIEW_INTERVALS
        reviews: 0,
        lapses: 0
    };
}

const addDays = (key, n) => {
    const [y, m, d] = key.split('-').map(Number);
    return todayKey(new Date(y, m - 1, d + n));
};

/**
 * 'again' sends the word back to tomorrow and down a step; 'good' moves it up
 * one interval; 'easy' skips one.
 */
export function reviewItem(item, grade, today = todayKey()) {
    let step = item.step;
    if (grade === 'again') step = Math.max(0, step - 1);
    else if (grade === 'easy') step = Math.min(REVIEW_INTERVALS.length - 1, step + 2);
    else step = Math.min(REVIEW_INTERVALS.length - 1, step + 1);
    const days = grade === 'again' ? 1 : REVIEW_INTERVALS[step];
    return {
        ...item,
        step,
        due: addDays(today, days),
        reviews: item.reviews + 1,
        lapses: item.lapses + (grade === 'again' ? 1 : 0)
    };
}

export const dueItems = (items, today = todayKey()) =>
    items.filter(i => daysBetween(i.due, today) >= 0).sort((a, b) => (a.due < b.due ? -1 : 1));

export const isLearned = (item) => item.step >= 3;

export function upsertVocab(items, item) {
    const i = items.findIndex(x => x.id === item.id);
    if (i === -1) return [item, ...items].slice(0, MAX_ITEMS);
    const next = [...items];
    next[i] = { ...next[i], ...item };
    return next;
}

export const removeVocab = (items, id) => items.filter(i => i.id !== id);

export function migrateVocab(raw) {
    if (!Array.isArray(raw)) return [];
    const isKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    return raw
        .filter(x => x && typeof x.word === 'string' && x.word.trim())
        .map(x => {
            const base = createVocabItem({ word: x.word.trim(), context: String(x.context ?? ''), source: String(x.source ?? ''), note: String(x.note ?? '') });
            return {
                ...base,
                addedAt: isKey(x.addedAt) ? x.addedAt : base.addedAt,
                due: isKey(x.due) ? x.due : base.due,
                step: Math.min(REVIEW_INTERVALS.length - 1, Math.max(0, Number.isInteger(x.step) ? x.step : 0)),
                reviews: Math.max(0, Number(x.reviews) || 0),
                lapses: Math.max(0, Number(x.lapses) || 0)
            };
        })
        .filter((item, i, all) => all.findIndex(x => x.id === item.id) === i)
        .slice(0, MAX_ITEMS);
}

// --- Flash recognition drill ----------------------------------------------

export const FLASH_START_MS = 400;
export const FLASH_MIN_MS = 40;
export const FLASH_MAX_MS = 1200;

/**
 * Staircase on exposure time: a correct pick shortens the next flash, a miss
 * lengthens it more, so it settles near the time you need to recognise a word.
 */
export function nextExposure(ms, correct) {
    const next = correct ? ms * 0.85 : ms * 1.3;
    return Math.round(Math.min(FLASH_MAX_MS, Math.max(FLASH_MIN_MS, next)));
}

/** A random word from the pool. Kept here so components stay pure. */
export const pickWord = (pool, random = Math.random) => pool[Math.floor(random() * pool.length)];

/**
 * One round: the flashed word plus three distractors, closest in length first
 * so the options cannot be told apart by shape alone. `random` is injectable
 * for tests.
 */
export function buildFlashRound(target, pool, random = Math.random) {
    const others = [...new Set(pool.map(w => w.toLowerCase()))].filter(w => w !== target);
    const byLength = others
        .map(w => ({ w, d: Math.abs(w.length - target.length) + random() }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 3)
        .map(x => x.w);
    const options = [...byLength, target];
    for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
    }
    return { target, options, answer: options.indexOf(target) };
}
