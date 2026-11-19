// Word counting that survives jumping around a passage.
//
// The recorded speed is words covered ÷ time spent. Rewinding to re-read a
// sentence or skipping ahead must not inflate or deflate that, so the count is
// banked at every jump: words covered before the jump are kept, and counting
// restarts from wherever you land. Re-reading a stretch counts it again, which
// is honest: you spent the time reading those words again.

export const startCount = (base = 0) => ({ counted: 0, base });

/** Words covered so far, with the cursor at `at`. */
export const wordsCovered = (count, at) => count.counted + Math.max(0, at - count.base);

/** Bank what was covered up to `from`, then restart counting at `to`. */
export const jump = (count, from, to) => ({ counted: wordsCovered(count, from), base: to });

/** Clamps a target index into the passage. */
export const clampIndex = (index, total) => Math.max(0, Math.min(Math.max(0, total - 1), Math.round(index)));

/** "1:05" for seconds. */
export function clock(secs) {
    const s = Math.max(0, Math.round(secs));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
