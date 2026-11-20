import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Paragraph } from './PacedText';

function measureWordTops(container, wordEls) {
    if (!container) return [];
    const baseTop = container.getBoundingClientRect().top;
    return wordEls.map(el => {
        if (!el) return 0;
        const r = el.getBoundingClientRect();
        return r.top - baseTop + r.height / 2;
    });
}

/**
 * Teleprompter-style scroll mode: text enters from the bottom and glides
 * smoothly upward past a central reading band at the target WPM.
 *
 * Like the pacer, the per-frame scroll is written straight to the DOM and
 * React only re-renders when the current word changes.
 */
export default function ScrollText({
    text,
    wpm,
    isRunning,
    bionicReading = false,
    bionicStrength = 0.5,
    dimRead = true,
    focalPct = 44,
    initialIndex = 0,
    seek = null,
    onWordClick,
    onProgress,
    onComplete
}) {
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

    const clampedInitial = Math.max(0, Math.min(totalWords, initialIndex));
    const progressRef = useRef(clampedInitial);
    const [readIndex, setReadIndex] = useState(Math.floor(clampedInitial));
    const readIndexRef = useRef(Math.floor(clampedInitial));
    const [viewportHeight, setViewportHeight] = useState(360);
    const viewportHeightRef = useRef(360);
    const focalRef = useRef(focalPct);
    useLayoutEffect(() => { focalRef.current = focalPct; });

    const setRef = useCallback((index, el) => { wordRefs.current[index] = el; }, []);

    /**
     * Interpolates the vertical position between the current word and the
     * next so the upward scroll is continuous rather than stepping by line.
     */
    const paint = useCallback((progress) => {
        const tops = wordTopsRef.current;
        const content = contentRef.current;
        if (!content) return;
        let targetY = 0;
        if (tops.length > 0) {
            const idx = Math.max(0, Math.min(tops.length - 1, Math.floor(progress)));
            const nextIdx = Math.min(tops.length - 1, idx + 1);
            const frac = Math.max(0, progress - Math.floor(progress));
            const y0 = tops[idx] ?? 0;
            const y1 = tops[nextIdx] ?? y0;
            targetY = y0 + (y1 - y0) * frac;
        }
        const focalY = viewportHeightRef.current * (focalRef.current / 100);
        content.style.transform = `translate3d(0, ${focalY - targetY}px, 0)`;
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
            wordTopsRef.current = measureWordTops(contentRef.current, wordRefs.current);
            paint(progressRef.current);
        };
        measure();
        const observer = new ResizeObserver(measure);
        if (viewportRef.current) observer.observe(viewportRef.current);
        if (contentRef.current) observer.observe(contentRef.current);
        document.fonts?.ready.then(measure).catch(() => {});
        return () => observer.disconnect();
    }, [paragraphs, bionicReading, totalWords, paint]);

    // Moving the reading band repositions the text under it.
    useLayoutEffect(() => { paint(progressRef.current); }, [focalPct, paint]);

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
            const next = Math.min(totalWords, progressRef.current + (delta / 60000) * wpm);
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

    const focalY = viewportHeight * (focalPct / 100);

    return (
        <div
            ref={viewportRef}
            className="relative w-full h-[24rem] md:h-[28rem] overflow-hidden select-none"
            style={{
                maskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)'
            }}
        >
            {/* Subtle reading band across the focal zone */}
            <div
                aria-hidden="true"
                className="absolute inset-x-0 pointer-events-none border-y border-purple-500/20 bg-purple-500/[0.04]"
                style={{ top: `${focalY - 22}px`, height: '44px' }}
            />

            <div
                ref={contentRef}
                className="mx-auto will-change-transform"
                style={{ maxWidth: 'var(--reading-max-width)' }}
            >
                <div className="space-y-6">
                    {paragraphs.map((para, p) => {
                        const start = para[0]?.index ?? 0;
                        const end = start + para.length;
                        return (
                            <Paragraph
                                key={p}
                                para={para}
                                readUntil={Math.max(start, Math.min(end, readIndex))}
                                currentIndex={-1}
                                dimRead={dimRead}
                                bionicReading={bionicReading}
                                bionicStrength={bionicStrength}
                                onWordClick={onWordClick}
                                setRef={setRef}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
