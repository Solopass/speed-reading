import { describe, expect, it } from 'vitest';
import { applyTheme, chartColors, normalizeTheme, resolveTheme } from './theme';

describe('theme', () => {
    it('defaults to dark for missing or unknown values', () => {
        expect(normalizeTheme(undefined)).toBe('dark');
        expect(normalizeTheme('sepia')).toBe('dark');
        expect(normalizeTheme('light')).toBe('light');
    });

    it('resolves system through the OS preference', () => {
        expect(resolveTheme('system', true)).toBe('dark');
        expect(resolveTheme('system', false)).toBe('light');
        expect(resolveTheme('light', true)).toBe('light');
        expect(resolveTheme('dark', false)).toBe('dark');
    });

    it('toggles exactly one of the light/dark classes', () => {
        const classes = new Set(['dark']);
        const root = { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } };
        applyTheme('light', root);
        expect([...classes]).toEqual(['light']);
        applyTheme('dark', root);
        expect([...classes]).toEqual(['dark']);
    });

    it('gives each theme its own chart colours', () => {
        expect(chartColors('light').grid).not.toBe(chartColors('dark').grid);
        expect(chartColors('anything')).toEqual(chartColors('dark'));
    });
});
