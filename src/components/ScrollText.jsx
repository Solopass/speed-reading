import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Paragraph } from './PacedText';
import { buildChunks, chunkIndexAt, pauseAfter, tokenize, wordWeights } from '../lib/chunker';
import {
    advanceByCost, gradientAnchors, gradientBackground, layoutLines, pacingCosts, textLooks
} from '../lib/textColor';
import { DEFAULT_READING } from '../lib/readingStyle';

/** Word centres (for the scroll) and boxes (for the line gradient), relative to the text column. */
function measureWords(container, wordEls) {
    if (!container) return { tops: [], boxes: [], width: 1 };
    const base = container.getBoundingClientRect();
    const tops = [];
    const boxes = [];
    for (const el of wordEls) {
        if (!el) { tops.push(0); boxes.push(null); continue; }
        const r = el.getBoundingClientRect();
        tops.push(r.top - base.top + r.height / 2);
        boxes.push({ top: r.top - base.top, left: r.left - base.left, right: r.right - base.left });
    }
    return { tops, boxes, width: base.width };
}

/** One line's height at the current reading settings, as CSS. */
const LINE = 'calc(var(--reading-prose-size) * var(--reading-line-height))';

/**
 * Teleprompter-style scroll mode: text enters from the bottom and glides
 * upward past a reading line at the target WPM.
 *
 * Like the pacer, the per-frame scroll is written straight to the DOM and
 * React only re-renders when the current word changes. Colours, spotlight,
 * pacing and motion come from the `reading` settings (see readingStyle.js).
 */
export default function ScrollText({
    text,
    wpm,
    isRunning,
    reading = DEFAULT_READING,
    bionicReading = false,
    initialIndex = 0,
    seek = null,
    onWordClick,
    onProgress,
    onComplete
}) {
    const {
        bionicStrength, dimRead, scrollFocalPct: focalPct, scrollColor, scrollPalette, scrollColorStrength,
        scrollFadeFunctionWords, scrollMarker, scrollGuide, scrollBandLines, scrollSpotlight, scrollEdgeFade,
        scrollHeightVh, scrollMotion, scrollPacing
    } = { ...DEFAULT_READING, ...reading };

    // Settings that move words without resizing the column (justify, spacing,
    // font, bold amount) emit no resize event, so they trigger a re-measure here;
    // otherwise the line gradient and the reading line would use stale positions.
    const { fontId, proseSizePx, lineHeight, letterSpacing, wordSpacing, maxWidthCh, justify, paragraphGapEm } = { ...DEFAULT_READING, ...reading };
    const layoutKey = [fontId, proseSizePx, lineHeight, letterSpacing, wordSpacing, maxWidthCh, justify, paragraphGapEm, bionicStrength].join('|');

    const viewportRef = useRef(null);
    const contentRef = useRef(null);
    const wordRefs = useRef([]);
    const wordTopsRef = useRef([]);

    const paragraphs = useMemo(() => {
        const paras = text.trim().split(/\n\s*\n/).filter(p => p.trim());
        let index = 0;
        return paras.map(p => p.trim().split(/\s+/).map(word => ({ word, index: index++ })));
    }, [text]);

    const totalWords = useMemo(
        () => paragraphs.reduce((sum, p) => sum + p.length, 0),
        [paragraphs]
    );

    // --- Text-derived data: phrases, colours, pacing -------------------------
    const words = useMemo(() => text.trim().split(/\s+/).filter(Boolean), [text]);
    const phrases = useMemo(() => buildChunks(text, { maxWords: 4 }), [text]);
    const baseLooks = useMemo(() => textLooks(text, {
        mode: scrollColor, paletteId: scrollPalette, strength: scrollColorStrength, fadeFunctionWords: scrollFadeFunctionWords
    }), [text, scrollColor, scrollPalette, scrollColorStrength, scrollFadeFunctionWords]);

    const costs = useMemo(() => {
        if (!scrollPacing) return null;
        const gaps = tokenize(text).map(t => t.gap);
        const pauses = words.map((w, i) => pauseAfter(w, gaps[i] ?? 0, words[i + 1]));
        return pacingCosts(words, wordWeights(words), pauses);
    }, [text, words, scrollPacing]);
    const costsRef = useRef(costs);
    useLayoutEffect(() => { costsRef.current = costs; });

    // The line gradient depends on where each word landed, so it is worked out
    // from the measured layout and redone only when the layout changes.
    const [layout, setLayout] = useState(null);
    const looks = useMemo(() => {
        if (scrollColor !== 'gradient' || !layout) return baseLooks;
        const anchors = gradientAnchors(scrollPalette, scrollColorStrength);
        const lines = layoutLines(layout.boxes, layout.width);
        return baseLooks.map((look, i) => (lines[i] ? { ...look, bg: gradientBackground(lines[i], anchors) } : look));
    }, [baseLooks, layout, scrollColor, scrollPalette, scrollColorStrength]);

    const clampedInitial = Math.max(0, Math.min(totalWords, initialIndex));
    const progressRef = useRef(clampedInitial);
    const [readIndex, setReadIndex] = useState(Math.floor(clampedInitial));
    const readIndexRef = useRef(Math.floor(clampedInitial));
    const [viewportHeight, setViewportHeight] = useState(360);
    const viewportHeightRef = useRef(360);
    const focalRef = useRef(focalPct);
    const motionRef = useRef(scrollMotion);
    useLayoutEffect(() => { focalRef.current = focalPct; motionRef.current = scrollMotion; });

    const setRef = useCallback((index, el) => { wordRefs.current[index] = el; }, []);

    /**
     * Smooth motion interpolates between the current word and the next so the
     * glide is continuous; line motion holds the current line still and eases
     * to the next one when the reading position moves onto it.
     */
    const paint = useCallback((progress) => {
        const tops = wordTopsRef.current;
        const content = contentRef.current;
        if (!content) return;
        let targetY = 0;
        if (tops.length > 0) {
            const idx = Math.max(0, Math.min(tops.length - 1, Math.floor(progress)));
            const y0 = tops[idx] ?? 0;
            if (motionRef.current === 'line') {
                targetY = y0;
            } else {
                const nextIdx = Math.min(tops.length - 1, idx + 1);
                const frac = Math.max(0, progress - Math.floor(progress));
                const y1 = tops[nextIdx] ?? y0;
                targetY = y0 + (y1 - y0) * frac;
            }
        }
        const focalY = viewportHeightRef.current * (focalRef.current / 100);
        const transform = `translate3d(0, ${focalY - targetY}px, 0)`;
        if (content.style.transform !== transform) content.style.transform = transform;
    }, []);

    const moveTo = useCallback((progress) => {
        progressRef.current = progress;
        paint(progress);
        const ri = Math.floor(progress);
        if (ri !== readIndexRef.current) {
            readIndexRef.current = ri;
            setReadIndex(ri);
        }
    }, [paint]);

    useLayoutEffect(() => {
        const measure = () => {
            wordRefs.current.length = totalWords;
            if (viewportRef.current) {
                viewportHeightRef.current = viewportRef.current.clientHeight;
                setViewportHeight(viewportRef.current.clientHeight);
            }
            // Measured with the transform in place; everything is relative to
            // the text column, so the scroll offset cancels out.
            const m = measureWords(contentRef.current, wordRefs.current);
            wordTopsRef.current = m.tops;
            setLayout(prev => {
                const key = m.boxes.map(b => (b ? `${Math.round(b.top)}:${Math.round(b.left)}` : '-')).join(',') + `|${Math.round(m.width)}`;
                return prev?.key === key ? prev : { key, boxes: m.boxes, width: m.width };
            });
            paint(progressRef.current);
        };
        measure();
        const observer = new ResizeObserver(measure);
        if (viewportRef.current) observer.observe(viewportRef.current);
        if (contentRef.current) observer.observe(contentRef.current);
        document.fonts?.ready.then(measure).catch(() => {});
        return () => observer.disconnect();
    }, [paragraphs, bionicReading, totalWords, paint, layoutKey]);

    // Moving the reading line or switching motion repositions the text.
    useLayoutEffect(() => {
        if (contentRef.current) {
            contentRef.current.style.transition = scrollMotion === 'line' ? 'transform 280ms cubic-bezier(0.2, 0.7, 0.2, 1)' : 'none';
        }
        paint(progressRef.current);
    }, [focalPct, scrollMotion, scrollHeightVh, paint]);

    useEffect(() => {
        let cancelled = false;
        const startAt = Math.max(0, Math.min(totalWords, initialIndex));
        queueMicrotask(() => { if (!cancelled) moveTo(startAt); });
        return () => { cancelled = true; };
    }, [text, initialIndex, totalWords, moveTo]);

    useEffect(() => {
        if (!seek) return undefined;
        let cancelled = false;
        const index = Math.max(0, Math.min(totalWords, seek.index));
        queueMicrotask(() => { if (!cancelled) moveTo(index); });
        return () => { cancelled = true; };
    }, [seek, totalWords, moveTo]);

    useEffect(() => {
        if (!isRunning || totalWords === 0) return undefined;

        let frame;
        let last = performance.now();

        const tick = (now) => {
            const delta = Math.min(100, now - last);
            last = now;
            const budget = (delta / 60000) * wpm;
            // Smart pacing spends the same time overall, just more of it on
            // long words and at punctuation, less on "the" and "of".
            const c = costsRef.current;
            const next = c ? advanceByCost(progressRef.current, budget, c) : Math.min(totalWords, progressRef.current + budget);
            moveTo(next);
            if (next < totalWords) frame = requestAnimationFrame(tick);
        };

        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [isRunning, wpm, totalWords, moveTo]);

    useEffect(() => {
        if (totalWords > 0 && readIndex >= totalWords) onComplete?.();
    }, [readIndex, totalWords, onComplete]);

    useEffect(() => { onProgress?.(readIndex); }, [readIndex, onProgress]);

    // The highlighted stretch at the reading line.
    const marker = useMemo(() => {
        if (scrollMarker === 'none' || readIndex >= totalWords) return null;
        if (scrollMarker === 'word') return [readIndex, readIndex + 1];
        const c = phrases[chunkIndexAt(phrases, readIndex)];
        return c ? [c.start, c.end] : [readIndex, readIndex + 1];
    }, [scrollMarker, readIndex, totalWords, phrases]);

    const focalY = viewportHeight * (focalPct / 100);
    const bandHeight = `calc(${LINE} * ${scrollBandLines} + 0.4em)`;
    const fade = scrollEdgeFade;
    const mask = fade > 0
        ? `linear-gradient(to bottom, transparent 0%, black ${fade}%, black ${100 - fade}%, transparent 100%)`
        : 'none';

    return (
        <div
            ref={viewportRef}
            className="relative w-full overflow-hidden select-none"
            style={{
                height: `max(16rem, ${scrollHeightVh}vh)`,
                fontSize: 'var(--reading-prose-size)',
                maskImage: mask,
                WebkitMaskImage: mask
            }}
        >
            {scrollGuide === 'band' && (
                <div
                    aria-hidden="true"
                    className="absolute inset-x-0 pointer-events-none border-y border-purple-500/20 bg-purple-500/[0.05]"
                    style={{ top: focalY, height: bandHeight, transform: 'translateY(-50%)' }}
                />
            )}
            {scrollGuide === 'line' && (
                <div
                    aria-hidden="true"
                    className="absolute inset-x-0 pointer-events-none bg-purple-500/50"
                    style={{ top: `calc(${focalY}px + ${LINE} * 0.5)`, height: 2 }}
                />
            )}

            <div
                ref={contentRef}
                className="mx-auto will-change-transform"
                style={{ maxWidth: 'var(--reading-max-width)' }}
            >
                {paragraphs.map((para, p) => {
                    const start = para[0]?.index ?? 0;
                    const end = start + para.length;
                    // Clamp the highlight to this paragraph, so the memoised
                    // paragraphs elsewhere do not re-render as it moves.
                    const inPara = marker && marker[0] < end && marker[1] > start;
                    return (
                        <Paragraph
                            key={p}
                            para={para}
                            readUntil={Math.max(start, Math.min(end, readIndex))}
                            currentIndex={inPara ? Math.max(start, marker[0]) : -1}
                            currentEnd={inPara ? Math.min(end, marker[1]) : undefined}
                            dimRead={dimRead}
                            bionicReading={bionicReading}
                            bionicStrength={bionicStrength}
                            onWordClick={onWordClick}
                            setRef={setRef}
                            looks={looks}
                        />
                    );
                })}
            </div>

            {/* Spotlight: text away from the reading line is dimmed by page-coloured veils. */}
            {scrollSpotlight > 0 && (
                <>
                    <div
                        aria-hidden="true"
                        className="absolute inset-x-0 top-0 pointer-events-none"
                        style={{
                            height: `calc(${focalY}px - ${bandHeight} / 2)`,
                            background: 'linear-gradient(to bottom, var(--reading-bg) 0%, var(--reading-bg) 25%, transparent 100%)',
                            opacity: scrollSpotlight
                        }}
                    />
                    <div
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-0 pointer-events-none"
                        style={{
                            top: `calc(${focalY}px + ${bandHeight} / 2)`,
                            background: 'linear-gradient(to top, var(--reading-bg) 0%, var(--reading-bg) 25%, transparent 100%)',
                            opacity: scrollSpotlight
                        }}
                    />
                </>
            )}
        </div>
    );
}
