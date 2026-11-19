// App chrome theme: 'dark' (default), 'light', or 'system' (follow the OS).
// Separate from the reading-surface themes in readingStyle.js, which set the
// page you read on and stay under their own control.

export const THEME_OPTIONS = [
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
    { id: 'system', label: 'System' }
];

export const DEFAULT_THEME = 'dark';

export function normalizeTheme(value) {
    return THEME_OPTIONS.some(o => o.id === value) ? value : DEFAULT_THEME;
}

/** The theme actually drawn: 'system' resolves through the OS preference. */
export function resolveTheme(setting, prefersDark) {
    const theme = normalizeTheme(setting);
    if (theme === 'system') return prefersDark ? 'dark' : 'light';
    return theme;
}

/** Puts the resolved theme on <html>, where the CSS palette overrides key off it. */
export function applyTheme(resolved, root = document.documentElement) {
    root.classList.toggle('light', resolved === 'light');
    root.classList.toggle('dark', resolved !== 'light');
}

/**
 * Recharts draws SVG attributes, which cannot read CSS variables, so charts
 * take concrete colours for the resolved theme.
 */
const CHART = {
    dark: {
        grid: '#1e293b', axis: '#64748b', tooltipBg: '#0f172a', tooltipBorder: '#1e293b',
        tooltipText: '#e2e8f0', accent: '#a855f7', accentSoft: '#c084fc',
        good: '#34d399', warn: '#fbbf24', info: '#60a5fa', muted: '#475569'
    },
    light: {
        grid: '#e2e8f0', axis: '#64748b', tooltipBg: '#ffffff', tooltipBorder: '#cbd5e1',
        tooltipText: '#0f172a', accent: '#9333ea', accentSoft: '#7e22ce',
        good: '#059669', warn: '#d97706', info: '#2563eb', muted: '#94a3b8'
    }
};

export const chartColors = (resolved) => CHART[resolved === 'light' ? 'light' : 'dark'];

/** Shared Recharts tooltip styling, so every chart's tooltip matches. */
export function tooltipStyle(resolved) {
    const c = chartColors(resolved);
    return {
        contentStyle: {
            backgroundColor: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`,
            borderRadius: '12px', color: c.tooltipText
        },
        labelStyle: { color: c.axis },
        itemStyle: { color: c.tooltipText }
    };
}
