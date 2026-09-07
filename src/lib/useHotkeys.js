import { useEffect, useRef } from 'react';

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True while the user is typing, so shortcuts never eat their keystrokes. */
export function isTypingTarget(target) {
    if (!target) return false;
    return TYPING_TAGS.has(target.tagName) || target.isContentEditable === true;
}

/**
 * Window-level keyboard shortcuts.
 *
 * The handler map is kept in a ref so callers can pass inline arrow functions
 * without re-binding the listener on every render, and every bound key is
 * preventDefault-ed: Space would otherwise both run the shortcut and activate
 * whatever button happens to have focus, toggling play twice.
 */
export default function useHotkeys(handlers, enabled = true) {
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    useEffect(() => {
        if (!enabled) return;

        const onKeyDown = (event) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            if (isTypingTarget(event.target)) return;

            const handler = handlersRef.current[event.key];
            if (!handler) return;

            event.preventDefault();
            handler(event);
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [enabled]);
}
