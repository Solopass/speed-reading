import { useEffect } from 'react';
import { readingCssVars, webFontHrefs } from '../lib/readingStyle';

/**
 * Wraps anything you actually read, applying the user's typography as CSS
 * custom properties. Every mode renders inside one of these, so RSVP, Paced and
 * Natural all obey the same settings and a WPM measured in one is comparable
 * with a WPM measured in another.
 */
export default function ReadingSurface({ reading, className = '', style = {}, paint = true, children }) {
    // Joined into a string so the effect compares by value: the array is rebuilt
    // on every render and would otherwise re-run this forever.
    const hrefs = webFontHrefs(reading);
    const hrefKey = hrefs.join('|');

    // Only injected when a web font is actually selected, so the default
    // system-stack setup makes no network request at all.
    useEffect(() => {
        if (!hrefKey) return;
        hrefKey.split('|').forEach(href => {
            if (document.head.querySelector(`link[data-reading-font="${href}"]`)) return;
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.dataset.readingFont = href;
            document.head.appendChild(link);
        });
    }, [hrefKey]);

    return (
        <div
            className={className}
            style={{
                ...readingCssVars(reading),
                // `paint: false` publishes the variables without colouring the
                // container. Surrounding chrome — mode switches, speed controls,
                // hints — is styled for the app's dark shell, so painting it
                // with a light reading theme leaves white text on a pale panel.
                ...(paint
                    ? { backgroundColor: 'var(--reading-bg)', color: 'var(--reading-fg)', fontFamily: 'var(--reading-font)' }
                    : {}),
                ...style
            }}
        >
            {children}
        </div>
    );
}

/** Shared prose styling, so the sample in Settings matches the real thing exactly. */
export const proseStyle = {
    fontFamily: 'var(--reading-font)',
    fontSize: 'var(--reading-prose-size)',
    lineHeight: 'var(--reading-line-height)',
    letterSpacing: 'var(--reading-letter-spacing)',
    wordSpacing: 'var(--reading-word-spacing)',
    maxWidth: 'var(--reading-max-width)',
    textAlign: 'var(--reading-align)',
    color: 'var(--reading-fg)'
};
