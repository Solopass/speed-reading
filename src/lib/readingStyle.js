// How text looks is not decoration in a speed-reading app — line width sets how
// many saccades a line costs, tracking and line height decide whether your eye
// can find the next line without a regression, and contrast decides how long
// you can keep going. This module is the single source of truth for the
// reading surface, so every mode renders under identical conditions and a
// measured WPM means the same thing session to session.

import { clampOr } from './num';

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
    { id: 'amber', label: 'Amber', value: '#f59e0b' },
    { id: 'purple', label: 'Purple', value: '#a855f7' },
    { id: 'cyan', label: 'Cyan', value: '#22d3ee' },
    { id: 'none', label: 'None', value: null }
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
    showFocalGuide: true,
    bionicStrength: 0.5   // fraction of each word emboldened
};

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
    bionicStrength: [0.2, 0.8]
};

const byId = (list, id, fallbackId) =>
    list.find(item => item.id === id) ?? list.find(item => item.id === fallbackId);

export const fontFor = (reading) => byId(FONT_OPTIONS, reading.fontId, 'sans');
export const themeFor = (reading) => byId(THEMES, reading.themeId, 'dark');
export const focalColorFor = (reading) => byId(FOCAL_COLORS, reading.focalColorId, 'red').value;

/** Validates anything that may have come from storage or an imported backup. */
export function normalizeReading(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const result = { ...DEFAULT_READING };

    for (const key of Object.keys(LIMITS)) {
        result[key] = clampOr(source[key], LIMITS[key], DEFAULT_READING[key]);
    }
    result.fontId = byId(FONT_OPTIONS, source.fontId, 'sans').id;
    result.themeId = byId(THEMES, source.themeId, 'dark').id;
    result.focalColorId = byId(FOCAL_COLORS, source.focalColorId, 'red').id;
    result.justify = source.justify === true;
    result.showFocalGuide = source.showFocalGuide !== false;
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
