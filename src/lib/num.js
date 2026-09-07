// One place for numeric coercion, because getting it subtly wrong has bitten
// this codebase three times in three different modules.
//
// The trap: Number(null), Number('') and Number(false) are all 0, and 0 passes
// Number.isFinite. A bare isFinite check therefore turns "missing" into a real
// value — which invented a 150 WPM baseline for every new user, scored unread
// practice at 0% comprehension, and snapped a cleared settings field to its
// minimum instead of its default.

export const isBlank = (value) =>
    value === null || value === undefined || value === '' || typeof value === 'boolean';

/** The number, or `fallback` when the input is blank or not a finite number. */
export function finiteOr(value, fallback) {
    if (isBlank(value)) return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/** Like finiteOr, then held inside [min, max]. */
export function clampOr(value, [min, max], fallback) {
    const n = finiteOr(value, fallback);
    return Math.min(max, Math.max(min, n));
}
