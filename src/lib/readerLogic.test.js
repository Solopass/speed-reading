import { describe, expect, it } from 'vitest';
import {
    MAX_WPM, autoStartPlays, blinkDue, blinkMayAdvance, checkWindowAfterSeek, checkpointDue, restartsFromTop
} from './readerLogic';

describe('checkpoint window after a jump', () => {
    it('a forward jump skips text: the window starts where you land', () => {
        expect(checkWindowAfterSeek(100, 500, 3500)).toBe(3500);
    });
    it('the automatic rewind on resume keeps what was read (no lost checkpoint)', () => {
        expect(checkWindowAfterSeek(100, 500, 496)).toBe(100);
    });
    it('rewinding before the window start widens it', () => {
        expect(checkWindowAfterSeek(400, 500, 300)).toBe(300);
    });
});

describe('checkpointDue', () => {
    const base = { enabled: true, mode: 'rsvp', isCalibration: false, lastSecs: 0, everyMin: 3 };
    it('waits for the interval, then for a sentence end, up to the grace period', () => {
        expect(checkpointDue({ ...base, playSecs: 170, atSentenceEnd: true })).toBe(false);
        expect(checkpointDue({ ...base, playSecs: 180, atSentenceEnd: false })).toBe(false);
        expect(checkpointDue({ ...base, playSecs: 180, atSentenceEnd: true })).toBe(true);
        expect(checkpointDue({ ...base, playSecs: 200, atSentenceEnd: false })).toBe(true);
    });
    it('never in Skim, Natural, the baseline test or when switched off', () => {
        for (const extra of [{ mode: 'skim' }, { mode: 'natural' }, { isCalibration: true }, { enabled: false }]) {
            expect(checkpointDue({ ...base, ...extra, playSecs: 999, atSentenceEnd: true })).toBe(false);
        }
    });
});

describe('blink breaks', () => {
    const base = { enabled: true, isCalibration: false, everyMs: 30000, isLast: false };
    it('blink at a sentence end once due, forced at 1.5x, never on the last flash', () => {
        expect(blinkDue({ ...base, sinceMs: 29000, atSentenceEnd: true })).toBe(false);
        expect(blinkDue({ ...base, sinceMs: 31000, atSentenceEnd: false })).toBe(false);
        expect(blinkDue({ ...base, sinceMs: 31000, atSentenceEnd: true })).toBe(true);
        expect(blinkDue({ ...base, sinceMs: 45000, atSentenceEnd: false })).toBe(true);
        expect(blinkDue({ ...base, sinceMs: 45000, atSentenceEnd: true, isLast: true })).toBe(false);
    });
    it('a jump during the blink is not undone', () => {
        expect(blinkMayAdvance(true, 120, 120)).toBe(true);
        expect(blinkMayAdvance(true, 130, 120)).toBe(false);
        expect(blinkMayAdvance(false, 120, 120)).toBe(false);
    });
});

describe('play and auto-start', () => {
    it('play at the end restarts in RSVP, Paced and Scroll', () => {
        for (const m of ['rsvp', 'paced', 'scroll', 'skim']) expect(restartsFromTop(m, 500, 500)).toBe(true);
        expect(restartsFromTop('natural', 500, 500)).toBe(false);
        expect(restartsFromTop('rsvp', 10, 500)).toBe(false);
    });
    it('auto-continued chapters play, except in Natural mode or the baseline', () => {
        expect(autoStartPlays(true, false, 'rsvp')).toBe(true);
        expect(autoStartPlays(true, false, 'natural')).toBe(false);
        expect(autoStartPlays(true, true, 'rsvp')).toBe(false);
        expect(autoStartPlays(false, false, 'rsvp')).toBe(false);
    });
    it('recorded speed can reach the playback maximum', () => {
        expect(MAX_WPM).toBe(2500);
    });
});
