// How text looks is not decoration in a speed-reading app — line width sets how
// many saccades a line costs, tracking and line height decide whether your eye
// can find the next line without a regression, and contrast decides how long
// you can keep going. This module is the single source of truth for the
// reading surface, so every mode renders under identical conditions and a
// measured WPM means the same thing session to session.

import { clampOr } from './num';
import { SCROLL_COLOR_MODES, SCROLL_PALETTES } from './textColor';

export { SCROLL_COLOR_MODES, SCROLL_PALETTES };

export const FONT_OPTIONS = [
    {
        id: 'sans', label: 'Sans', note: 'Neutral default',
        stack: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    },
    {
        id: 'serif', label: 'Serif', note: 'Many readers prefer it for long prose',
        stack: 'Charter, Georgia, Cambria, "Times New Roman", serif'
    },
    {
        id: 'mono', label: 'Mono', note: 'Even widths, easy to track',
        stack: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
    },
    {
        id: 'lexend', label: 'Lexend', note: 'Designed to reduce visual stress',
        stack: '"Lexend", ui-sans-serif, system-ui, sans-serif',
        hrefs: ['https://fonts.googleapis.com/css2?family=Lexend:wght@400;700&display=swap']
    },
    {
        id: 'atkinson', label: 'Atkinson Hyperlegible', note: 'Letterforms built to be told apart',
        stack: '"Atkinson Hyperlegible", ui-sans-serif, system-ui, sans-serif',
        hrefs: ['https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap']
    },
    {
        id: 'opendyslexic', label: 'OpenDyslexic', note: 'Weighted bottoms; helps some dyslexic readers',
        stack: '"OpenDyslexic", "Comic Sans MS", ui-sans-serif, sans-serif',
        // Not on Google Fonts, whatever the family name suggests — asking for it
        // there fails silently and drops you to Comic Sans. Fontsource publishes
        // it, one stylesheet per weight, and bold is needed for bionic mode.
        hrefs: [
            'https://cdn.jsdelivr.net/npm/@fontsource/opendyslexic@5/400.css',
            'https://cdn.jsdelivr.net/npm/@fontsource/opendyslexic@5/700.css'
        ]
    }
];

export const THEMES = [
    { id: 'dark', label: 'Dark', bg: '#0f172a', panel: '#1e293b', fg: '#e2e8f0', muted: '#64748b' },
    { id: 'darkWarm', label: 'Warm dark', bg: '#1c1917', panel: '#292524', fg: '#e7e5e4', muted: '#78716c' },
    { id: 'sepia', label: 'Sepia', bg: '#f5ecd9', panel: '#ece0c8', fg: '#3b2f21', muted: '#8a7a63' },
    { id: 'light', label: 'Light', bg: '#f8fafc', panel: '#eef2f7', fg: '#1e293b', muted: '#64748b' },
    { id: 'contrast', label: 'High contrast', bg: '#000000', panel: '#141414', fg: '#ffffff', muted: '#a3a3a3' }
];

export const FOCAL_COLORS = [
    { id: 'red', label: 'Red', value: '#ef4444' },
    { id: 'coral', label: 'Coral', value: '#fb7185' },
    { id: 'amber', label: 'Amber', value: '#f59e0b' },
    { id: 'gold', label: 'Gold', value: '#eab308' },
    { id: 'lime', label: 'Lime', value: '#84cc16' },
    { id: 'emerald', label: 'Emerald', value: '#10b981' },
    { id: 'teal', label: 'Teal', value: '#14b8a6' },
    { id: 'cyan', label: 'Cyan', value: '#22d3ee' },
    { id: 'sky', label: 'Sky', value: '#38bdf8' },
    { id: 'indigo', label: 'Indigo', value: '#818cf8' },
    { id: 'purple', label: 'Purple', value: '#a855f7' },
    { id: 'pink', label: 'Pink', value: '#ec4899' },
    { id: 'none', label: 'None', value: null }
];

export const FOCAL_SPANS = [
    { id: 'single', label: '1 letter', note: 'Classic single-letter ORP anchor' },
    { id: 'cluster', label: '3-letter cluster', note: 'Highlights the focal letter and its two neighbours for faster high-WPM locking' },
    { id: 'allOrps', label: "Every word's ORP", note: 'In multi-word flashes, highlights the ORP of every word' },
    { id: 'gradient', label: 'Focal fade', note: 'Strongest at the focal letter, tapering outward' }
];

export const RSVP_CONTEXT_PLAY_MODES = [
    { id: 'show', label: 'Show', note: 'Keep surrounding lines visible while playing' },
    { id: 'dim', label: 'Dim', note: 'Fade surrounding lines while playing' },
    { id: 'hide', label: 'Hide', note: 'Hide surrounding lines while playing for pure tunnel focus' }
];

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
export const normalizeHexColor = (val, fallback = '#f43f5e') =>
    (typeof val === 'string' && HEX_COLOR_RE.test(val.trim()) ? val.trim().toLowerCase() : fallback);

/** How the Paced and Skim modes mark your place. */
export const PACER_STYLES = [
    { id: 'band', label: 'Line + cursor', note: 'Highlights the line and sweeps a cursor along it' },
    { id: 'word', label: 'Word', note: 'Highlights the word you should be on' },
    { id: 'underline', label: 'Underline', note: 'A bar under the current stretch of text' },
    { id: 'line', label: 'Line only', note: 'Just the line, no cursor; the lightest guide' }
];

/** The kind of question a reader checkpoint asks. */
export const CHECKPOINT_KINDS = [
    { id: 'mixed', label: 'Mixed', note: 'Mostly missing words, sometimes which sentence you read' },
    { id: 'word', label: 'Missing word', note: 'A sentence you just read with one word blanked out' },
    { id: 'sentence', label: 'Which sentence', note: 'Pick the sentence you just read from three' }
];

/** What marks your place in Scroll mode. */
export const SCROLL_GUIDES = [
    { id: 'band', label: 'Band', note: 'A soft band across the reading line' },
    { id: 'line', label: 'Thin line', note: 'A hairline under the reading line' },
    { id: 'none', label: 'None', note: 'No guide; the spotlight alone' }
];

/** Highlight on the words at the reading line in Scroll mode. */
export const SCROLL_MARKERS = [
    { id: 'none', label: 'None', note: 'No highlight' },
    { id: 'word', label: 'Word', note: 'The word you should be on' },
    { id: 'phrase', label: 'Phrase', note: 'The 3-5 word phrase you should be taking in' }
];

export const SCROLL_MOTIONS = [
    { id: 'smooth', label: 'Smooth', note: 'Continuous word-paced glide across each line' },
    { id: 'constant', label: 'Constant glide', note: 'Pure constant pixel speed — never surges on short lines' },
    { id: 'line', label: 'Line by line', note: 'Holds each line still, then steps up one line' }
];

export const DEFAULT_READING = {
    fontId: 'sans',
    themeId: 'dark',
    proseSizePx: 20,      // Natural and Paced modes
    rsvpSizePx: 64,       // the single flashed word
    lineHeight: 1.7,
    letterSpacing: 0,     // em
    wordSpacing: 0,       // em
    maxWidthCh: 66,       // characters per line
    justify: false,
    paragraphGapEm: 1.2,
    focalColorId: 'red',
    focalCustomColor: '#f43f5e',
    savedFocalColors: [],
    focalSpan: 'single',
    showFocalGuide: true,
    bionicStrength: 0.5,  // fraction of each word emboldened
    // In-reader behaviour, adjustable from the reader's settings drawer.
    pacerStyle: 'band',
    dimRead: true,        // fade words the pacer has passed
    rsvpContext: true,    // show before and after text above and below the RSVP flash
    scrollFocalPct: 44,   // vertical position (%) of the reading band in Scroll mode
    // Scroll mode
    scrollColor: 'none',          // none | gradient | phrases | sentences (textColor.js)
    scrollPalette: 'classic',
    scrollColorStrength: 0.7,     // how much of the palette colour is mixed into the text colour
    scrollFadeFunctionWords: false,
    scrollMarker: 'none',         // none | word | phrase
    scrollGuide: 'band',          // band | line | none
    scrollBandLines: 1,           // height of the band, in lines
    scrollSpotlight: 0.35,        // how far text away from the reading line is dimmed
    scrollEdgeFade: 18,           // % of the window faded at top and bottom
    scrollTunnel: 0,              // % horizontal edge fade (focus tunnel) in Scroll mode
    scrollHeightVh: 55,           // window height, % of the screen
    scrollMotion: 'smooth',
    scrollPacing: true,           // slow at punctuation and long words, same average speed
    countdown: true,      // 3-2-1 before playback starts
    accelWpmPerMin: 0,    // speed builder: WPM added per minute of reading (0 = off)
    accelCapPct: 140,     // ...up to this % of the speed you started at
    rewindWords: 0,       // words to step back when you resume after a pause
    rsvpWeight: 400,      // font weight of the flashed words
    rsvpFlankOpacity: 0.8, // opacity of non-focal letters around the anchor
    readOpacity: 0.45,    // how visible text already read stays, when fading is on
    rarityPacing: true,   // more time for rare words (RSVP and Scroll smart pacing)
    holdSlowPct: 60,      // speed while Shift is held down
    rsvpPreviewNext: false, // show the next group faintly under the flash
    rsvpContextPlay: 'dim', // show | dim | hide surrounding context while playing
    rsvpMergeShortWords: false, // pair tiny glue words with their neighbour in 1-word RSVP
    speedRamp: false,     // ease in from 70% of the target over the first quarter
    zen: false,           // hide the controls while playing
    // Measurement and comfort while reading (each can be switched off)
    checkpoints: true,        // fill-the-blank check on a sentence you just read
    checkpointEveryMin: 3,    // minutes of reading between checks
    checkpointKind: 'mixed',  // mixed | word | sentence
    adaptiveChunk: true,      // checkpoint results step words-per-flash up or down (2-5)
    blinkBreaks: true,        // a short blank gap in RSVP so your eyes can blink
    blinkEverySec: 30,
    speedTrace: true,         // live speed line under the progress bar
    difficultyMap: true,      // shade the progress bar by how dense the text is
    scrollEaseHard: true,     // Scroll eases off just before dense stretches
    remoteControls: true,     // presentation clickers, page-turners and gamepads
    chapterEndQuiz: true      // write a quiz at the end of a book chapter that has none
};

const BOOLEAN_PREFS = ['dimRead', 'rsvpContext', 'countdown', 'speedRamp', 'zen', 'scrollFadeFunctionWords', 'scrollPacing', 'rarityPacing', 'rsvpPreviewNext', 'rsvpMergeShortWords',
    'checkpoints', 'adaptiveChunk', 'blinkBreaks', 'speedTrace', 'difficultyMap', 'scrollEaseHard', 'remoteControls', 'chapterEndQuiz'];

/**
 * Speed multiplier for the warm-up ramp: 70% at the first word, rising to full
 * speed a quarter of the way through. Starting cold at full target speed costs
 * comprehension in the first paragraph; this eases into it.
 */
export function rampFactor(fraction, enabled = true) {
    if (!enabled) return 1;
    const f = Math.min(1, Math.max(0, fraction) / 0.25);
    return 0.7 + 0.3 * f;
}

// Ranges are deliberately generous — the point is to let someone find their own
// optimum, not to enforce mine.
export const LIMITS = {
    proseSizePx: [12, 44],
    rsvpSizePx: [24, 140],
    lineHeight: [1.1, 2.6],
    letterSpacing: [-0.05, 0.35],
    wordSpacing: [0, 1],
    maxWidthCh: [30, 110],
    paragraphGapEm: [0, 3],
    bionicStrength: [0.2, 0.8],
    scrollFocalPct: [20, 75],
    scrollColorStrength: [0.2, 1],
    scrollBandLines: [1, 3],
    scrollSpotlight: [0, 0.85],
    scrollEdgeFade: [0, 40],
    scrollTunnel: [0, 35],
    scrollHeightVh: [35, 85],
    accelWpmPerMin: [0, 60],
    accelCapPct: [110, 200],
    rewindWords: [0, 12],
    rsvpWeight: [300, 800],
    rsvpFlankOpacity: [0.3, 1],
    readOpacity: [0.1, 0.9],
    holdSlowPct: [30, 90],
    checkpointEveryMin: [1, 10],
    blinkEverySec: [10, 60]
};

const byId = (list, id, fallbackId) =>
    list.find(item => item.id === id) ?? list.find(item => item.id === fallbackId);

export const fontFor = (reading) => byId(FONT_OPTIONS, reading.fontId, 'sans');
export const themeFor = (reading) => byId(THEMES, reading.themeId, 'dark');
export const focalColorFor = (reading) => {
    if (reading?.focalColorId === 'custom') return normalizeHexColor(reading?.focalCustomColor);
    return byId(FOCAL_COLORS, reading?.focalColorId, 'red').value;
};

/** Validates anything that may have come from storage or an imported backup. */
export function normalizeReading(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const result = { ...DEFAULT_READING };

    for (const key of Object.keys(LIMITS)) {
        result[key] = clampOr(source[key], LIMITS[key], DEFAULT_READING[key]);
    }
    result.fontId = byId(FONT_OPTIONS, source.fontId, 'sans').id;
    result.themeId = byId(THEMES, source.themeId, 'dark').id;
    result.focalColorId = source.focalColorId === 'custom'
        ? 'custom'
        : byId(FOCAL_COLORS, source.focalColorId, 'red').id;
    result.focalSpan = byId(FOCAL_SPANS, source.focalSpan, 'single').id;
    result.rsvpContextPlay = byId(RSVP_CONTEXT_PLAY_MODES, source.rsvpContextPlay, 'dim').id;
    result.focalCustomColor = normalizeHexColor(source.focalCustomColor, DEFAULT_READING.focalCustomColor);
    result.savedFocalColors = Array.isArray(source.savedFocalColors)
        ? [...new Set(source.savedFocalColors.map(c => normalizeHexColor(c, '')).filter(Boolean))].slice(0, 12)
        : [];
    result.justify = source.justify === true;
    result.showFocalGuide = source.showFocalGuide !== false;
    result.pacerStyle = byId(PACER_STYLES, source.pacerStyle, 'band').id;
    result.scrollColor = byId(SCROLL_COLOR_MODES, source.scrollColor, 'none').id;
    result.scrollPalette = byId(SCROLL_PALETTES, source.scrollPalette, 'classic').id;
    result.scrollMarker = byId(SCROLL_MARKERS, source.scrollMarker, 'none').id;
    result.scrollGuide = byId(SCROLL_GUIDES, source.scrollGuide, 'band').id;
    result.scrollMotion = byId(SCROLL_MOTIONS, source.scrollMotion, 'smooth').id;
    result.checkpointKind = byId(CHECKPOINT_KINDS, source.checkpointKind, 'mixed').id;
    result.scrollBandLines = Math.round(result.scrollBandLines);
    result.rewindWords = Math.round(result.rewindWords);
    result.rsvpWeight = Math.round(result.rsvpWeight / 100) * 100;
    for (const key of BOOLEAN_PREFS) {
        result[key] = typeof source[key] === 'boolean' ? source[key] : DEFAULT_READING[key];
    }
    return result;
}

/** CSS custom properties consumed by every reading surface. */
export function readingCssVars(raw) {
    const reading = normalizeReading(raw);
    const theme = themeFor(reading);
    const focal = focalColorFor(reading);

    return {
        '--reading-font': fontFor(reading).stack,
        '--reading-prose-size': `${reading.proseSizePx}px`,
        // Capped against viewport width as well as the chosen size: a long word
        // at 64px does not fit a phone, and the RSVP container clips rather
        // than wraps, so letters would silently disappear off the edge.
        '--reading-rsvp-size': `min(${reading.rsvpSizePx}px, 9vw)`,
        '--reading-line-height': String(reading.lineHeight),
        '--reading-letter-spacing': `${reading.letterSpacing}em`,
        '--reading-word-spacing': `${reading.wordSpacing}em`,
        '--reading-max-width': `${reading.maxWidthCh}ch`,
        '--reading-align': reading.justify ? 'justify' : 'left',
        '--reading-paragraph-gap': `${reading.paragraphGapEm}em`,
        '--reading-bg': theme.bg,
        '--reading-panel': theme.panel,
        '--reading-fg': theme.fg,
        '--reading-muted': theme.muted,
        '--reading-focal': focal ?? theme.fg
    };
}

/**
 * Stylesheets to load for the selected font — empty for the system stacks, so
 * the default setup makes no network request at all.
 *
 * Read straight off the option rather than from a parallel lookup. Holding the
 * "this is a web font" flag in one place and its URL in another let OpenDyslexic
 * ship pointing at a Google Fonts family that does not exist: the request failed
 * silently and the stack fell through to Comic Sans.
 */
export const webFontHrefs = (reading) => fontFor(reading).hrefs ?? [];

/**
 * Roughly how many words fit on a line at the current settings. Useful feedback
 * while tuning: research puts comfortable line length near 50-75 characters,
 * and lines far outside that cost extra fixations or extra return sweeps.
 */
export const estimatedWordsPerLine = (reading) =>
    Math.max(1, Math.round(normalizeReading(reading).maxWidthCh / 5.5));

/** Built-in one-click reading profiles. */
export const BUILTIN_PRESETS = [
    {
        id: 'chill-scroll',
        name: 'Chill Scroll',
        note: 'Constant-glide teleprompter with soft band & comfortable width',
        reading: {
            scrollMotion: 'constant',
            scrollGuide: 'band',
            scrollSpotlight: 0.35,
            scrollTunnel: 0,
            maxWidthCh: 62,
            proseSizePx: 21
        }
    },
    {
        id: 'tunnel-1100',
        name: 'Tunnel Focus 1100+',
        note: '3-letter focal cluster, dimmed flanks, hidden context while playing, glue-word merge',
        reading: {
            focalSpan: 'cluster',
            rsvpFlankOpacity: 0.55,
            rsvpContextPlay: 'hide',
            rsvpMergeShortWords: true,
            showFocalGuide: true,
            rsvpSizePx: 68
        }
    },
    {
        id: 'clean-rsvp',
        name: 'Clean RSVP',
        note: 'Classic single-letter ORP with dimmed context',
        reading: {
            focalSpan: 'single',
            rsvpFlankOpacity: 0.8,
            rsvpContextPlay: 'dim',
            rsvpMergeShortWords: false,
            showFocalGuide: true
        }
    },
    {
        id: 'night-glide',
        name: 'Night Glide',
        note: 'High-contrast constant scroll with phrase colour & focus tunnel',
        reading: {
            themeId: 'contrast',
            scrollMotion: 'constant',
            scrollTunnel: 15,
            scrollSpotlight: 0.5,
            scrollColor: 'phrases'
        }
    }
];

/** Normalizes a user-saved custom preset entry. */
export function normalizePreset(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name ?? '').trim().slice(0, 40);
    if (!name) return null;
    const id = String(raw.id || `custom-${Date.now()}`);
    return {
        id,
        name,
        reading: normalizeReading(raw.reading)
    };
}
