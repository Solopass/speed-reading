import { describe, expect, it } from 'vitest';
import {
    DEFAULT_READING, FOCAL_COLORS, FONT_OPTIONS, LIMITS, THEMES,
    estimatedWordsPerLine, focalColorFor, fontFor, normalizeReading,
    readingCssVars, themeFor, webFontHrefs
} from './readingStyle';

describe('option tables', () => {
    it('every font and theme has a unique id', () => {
        expect(new Set(FONT_OPTIONS.map(f => f.id)).size).toBe(FONT_OPTIONS.length);
        expect(new Set(THEMES.map(t => t.id)).size).toBe(THEMES.length);
    });

    it('every font ends in a generic family, so it degrades if the webfont fails', () => {
        FONT_OPTIONS.forEach(font => {
            expect(font.stack).toMatch(/(sans-serif|serif|monospace)$/);
        });
    });

    it('every theme defines a full palette', () => {
        THEMES.forEach(theme => {
            ['bg', 'panel', 'fg', 'muted'].forEach(key => expect(theme[key]).toMatch(/^#[0-9a-f]{6}$/i));
        });
    });

    it('the defaults are themselves valid', () => {
        expect(normalizeReading(DEFAULT_READING)).toEqual(DEFAULT_READING);
    });
});

describe('normalizeReading', () => {
    it('falls back to defaults for junk', () => {
        expect(normalizeReading(null)).toEqual(DEFAULT_READING);
        expect(normalizeReading('nonsense')).toEqual(DEFAULT_READING);
        expect(normalizeReading({})).toEqual(DEFAULT_READING);
    });

    it('keeps values inside their range instead of rejecting them', () => {
        expect(normalizeReading({ proseSizePx: 9999 }).proseSizePx).toBe(LIMITS.proseSizePx[1]);
        expect(normalizeReading({ proseSizePx: -5 }).proseSizePx).toBe(LIMITS.proseSizePx[0]);
        expect(normalizeReading({ maxWidthCh: 1 }).maxWidthCh).toBe(LIMITS.maxWidthCh[0]);
    });

    it('ignores unknown font, theme and colour ids', () => {
        const result = normalizeReading({ fontId: 'papyrus', themeId: 'neon', focalColorId: 'chartreuse' });
        expect(result.fontId).toBe('sans');
        expect(result.themeId).toBe('dark');
        expect(result.focalColorId).toBe('red');
    });

    it('preserves a valid custom configuration', () => {
        const custom = { ...DEFAULT_READING, fontId: 'serif', themeId: 'sepia', proseSizePx: 24, maxWidthCh: 52, justify: true };
        expect(normalizeReading(custom)).toMatchObject({ fontId: 'serif', themeId: 'sepia', proseSizePx: 24, maxWidthCh: 52, justify: true });
    });

    it('treats the focal guide as on unless explicitly disabled', () => {
        expect(normalizeReading({}).showFocalGuide).toBe(true);
        expect(normalizeReading({ showFocalGuide: false }).showFocalGuide).toBe(false);
    });

    it('rejects NaN, which sliders can produce from an empty field', () => {
        expect(normalizeReading({ lineHeight: NaN }).lineHeight).toBe(DEFAULT_READING.lineHeight);
        expect(normalizeReading({ proseSizePx: '' }).proseSizePx).toBe(DEFAULT_READING.proseSizePx);
    });
});

describe('lookups', () => {
    it('resolves the selected font, theme and focal colour', () => {
        expect(fontFor({ fontId: 'mono' }).label).toBe('Mono');
        expect(themeFor({ themeId: 'sepia' }).label).toBe('Sepia');
        expect(focalColorFor({ focalColorId: 'cyan' })).toBe('#22d3ee');
    });

    it('supports switching the focal highlight off', () => {
        expect(FOCAL_COLORS.find(c => c.id === 'none').value).toBeNull();
    });
});

describe('readingCssVars', () => {
    const vars = readingCssVars({ ...DEFAULT_READING, proseSizePx: 22, maxWidthCh: 60, justify: true });

    it('emits units the browser can use', () => {
        expect(vars['--reading-prose-size']).toBe('22px');
        // Capped against viewport width so long words cannot overflow a phone.
        expect(vars['--reading-rsvp-size']).toMatch(/^min\(\d+px, \d+vw\)$/);
        expect(vars['--reading-max-width']).toBe('60ch');
        expect(vars['--reading-align']).toBe('justify');
        expect(vars['--reading-line-height']).toBe(String(DEFAULT_READING.lineHeight));
    });

    it('never emits undefined, which would blank the reading surface', () => {
        Object.values(readingCssVars(null)).forEach(value => {
            expect(value).toBeTruthy();
            expect(String(value)).not.toContain('undefined');
        });
    });

    it('falls back to the text colour when the focal highlight is off', () => {
        const off = readingCssVars({ ...DEFAULT_READING, focalColorId: 'none', themeId: 'light' });
        expect(off['--reading-focal']).toBe(themeFor({ themeId: 'light' }).fg);
    });
});

describe('webFontHrefs', () => {
    it('fetches nothing for the system stacks', () => {
        expect(webFontHrefs({ fontId: 'sans' })).toEqual([]);
        expect(webFontHrefs({ fontId: 'serif' })).toEqual([]);
        expect(webFontHrefs({ fontId: 'mono' })).toEqual([]);
    });

    it('returns stylesheets only for the font actually chosen', () => {
        expect(webFontHrefs({ fontId: 'lexend' }).join()).toContain('Lexend');
        expect(webFontHrefs({ fontId: 'atkinson' }).join()).toContain('Atkinson');
    });

    // OpenDyslexic shipped pointing at a Google Fonts family that does not
    // exist. The request failed silently and the stack fell through to Comic
    // Sans, so the font nobody tested was the one that was broken.
    it('gives every non-system font a real source', () => {
        const webFonts = FONT_OPTIONS.filter(f => f.hrefs);
        expect(webFonts.length).toBeGreaterThan(0);
        webFonts.forEach(font => {
            expect(webFontHrefs({ fontId: font.id }).length).toBeGreaterThan(0);
            webFontHrefs({ fontId: font.id }).forEach(href => {
                expect(href).toMatch(/^https:\/\//);
            });
        });
    });

    // Bionic mode emboldens part of every word, so a font with no bold face
    // gets synthesised (smeared) bold instead of the real one.
    it('loads a bold face for OpenDyslexic, which needs one file per weight', () => {
        const hrefs = webFontHrefs({ fontId: 'opendyslexic' });
        expect(hrefs.some(h => h.includes('700'))).toBe(true);
        expect(hrefs.some(h => h.includes('400'))).toBe(true);
        expect(hrefs.every(h => !h.includes('fonts.googleapis.com'))).toBe(true);
    });

    it('names a family the stack actually asks for', () => {
        FONT_OPTIONS.filter(f => f.hrefs).forEach(font => {
            const first = font.stack.split(',')[0].replace(/["']/g, '').trim();
            expect(first.length).toBeGreaterThan(0);
        });
    });
});

describe('estimatedWordsPerLine', () => {
    it('scales with line width', () => {
        expect(estimatedWordsPerLine({ maxWidthCh: 30 })).toBeLessThan(estimatedWordsPerLine({ maxWidthCh: 100 }));
    });

    it('never reports zero words per line', () => {
        expect(estimatedWordsPerLine({ maxWidthCh: 0 })).toBeGreaterThanOrEqual(1);
    });
});
