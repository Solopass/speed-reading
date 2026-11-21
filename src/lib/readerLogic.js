// The Reader's timing rules as plain functions, so they can be tested without
// a browser. The component calls these; the bugs they guard against were all
// found in review (see the tests for each scenario).

/**
 * Where the next checkpoint's text window starts after a jump. A jump forward
 * past the cursor skips text, so the window starts at the landing point; a
 * step back (including the automatic rewind on resume) keeps what was read.
 */
export function checkWindowAfterSeek(windowStart, cursor, to) {
    return to > cursor ? to : Math.min(windowStart, to);
}

/**
 * Whether a checkpoint should be asked now. It is due after `everyMin` minutes
 * of reading, waits for a sentence to end, but not for more than `graceSecs`.
 * Never in Natural (no cursor) or Skim (read for gist) or the baseline test.
 */
export function checkpointDue({ enabled, mode, isCalibration, playSecs, lastSecs, everyMin, atSentenceEnd, graceSecs = 20 }) {
    if (!enabled || isCalibration || mode === 'natural' || mode === 'skim') return false;
    const since = playSecs - lastSecs;
    const every = everyMin * 60;
    if (since < every) return false;
    return atSentenceEnd || since >= every + graceSecs;
}

/**
 * Whether the next RSVP advance should first show a blank blink. Due after
 * `everyMs`, preferably at a sentence end, forced at 1.5x the interval;
 * never before the last flash (that ends the passage).
 */
export function blinkDue({ enabled, isCalibration, sinceMs, everyMs, atSentenceEnd, isLast }) {
    if (!enabled || isCalibration || isLast) return false;
    if (sinceMs < everyMs) return false;
    return atSentenceEnd || sinceMs >= everyMs * 1.5;
}

/** Whether a blink that started at `blinkFrom` may still advance: only if nothing moved the reader since. */
export const blinkMayAdvance = (isPlaying, currentIndex, blinkFrom) => isPlaying && currentIndex === blinkFrom;

/** Pressing play at the very end starts again from the top, in every mode with a cursor. */
export const restartsFromTop = (mode, cursor, total) => mode !== 'natural' && total > 0 && cursor >= total;

/** An auto-continued chapter starts playing by itself, except in Natural mode and the baseline test. */
export const autoStartPlays = (autoStart, isCalibration, mode) => Boolean(autoStart) && !isCalibration && mode !== 'natural';

/** The fastest speed playback can reach; recorded speeds are capped to match. */
export const MAX_WPM = 2500;
