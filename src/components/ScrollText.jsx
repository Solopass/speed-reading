import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

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
 */
export default function ScrollText({
    text,
    wpm,
    isRunning,
    bionicReading = false,
    bionicStrength = 0.5,
    dimRead = true,
    initialIndex = 0,
    seek = null,
    onWordClick,
    onProgress,
    onComplete
}) {
    const viewportRef = useRef(null);
    const contentRef = useRef(null);
    const wordRefs = useRef([]);

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
    const [progress, setProgress] = useState(clampedInitial);
    const progressRef = useRef(clampedInitial);
    const [wordTops, setWordTops] = useState([]);
    const [viewportHeight, setViewportHeight] = useState(360);

    useLayoutEffect(() => {
        const measure = () => {
            wordRefs.current.length = totalWords;
            if (viewportRef.current) setViewportHeight(viewportRef.current.clientHeight);
            setWordTops(measureWordTops(contentRef.current, wordRefs.current));
        };
        measure();
        const observer = new ResizeObserver(measure);
        if (viewportRef.current) observer.observe(viewportRef.current);
        if (contentRef.current) observer.observe(contentRef.current);
        document.fonts?.ready.then(measure).catch(() => {});
        return () => observer.disconnect();
    }, [paragraphs, bionicReading, totalWords]);

    useEffect(() => {
        let cancelled = false;
        const startAt = Math.max(0, Math.min(totalWords, initialIndex));
        queueMicrotask(() => {
            if (cancelled) return;
            progressRef.current = startAt;
            setProgress(startAt);
        });
        return () => { cancelled = true; };
    }, [text, initialIndex, totalWords]);

    useEffect(() => {
        if (!seek) return undefined;
        let cancelled = false;
        const index = Math.max(0, Math.min(totalWords, seek.index));
        queueMicrotask(() => {
            if (cancelled) return;
            progressRef.current = index;
            setProgress(index);
        });
        return () => { cancelled = true; };
    }, [seek, totalWords]);

    useEffect(() => {
        if (!isRunning || totalWords === 0) return undefined;

        let frame;
        let last = performance.now();

        const tick = (now) => {
            const delta = Math.min(100, now - last);
            last = now;
            const next = Math.min(totalWords, progressRef.current + (delta / 60000) * wpm);
            progressRef.current = next;
            setProgress(next);
            if (next < totalWords) frame = requestAnimationFrame(tick);
        };

        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [isRunning, wpm, totalWords]);

    useEffect(() => {
        if (totalWords > 0 && progress >= totalWords) onComplete?.();
    }, [progress, totalWords, onComplete]);

    useEffect(() => { onProgress?.(Math.floor(progress)); }, [progress, onProgress]);

    // Interpolate vertical position between the current word and the next so
    // the upward scroll is continuous rather than stepping line by line.
    const focalY = viewportHeight * 0.44;
    let targetY = 0;
    if (wordTops.length > 0) {
        const idx = Math.max(0, Math.min(wordTops.length - 1, Math.floor(progress)));
        const nextIdx = Math.min(wordTops.length - 1, idx + 1);
        const frac = Math.max(0, progress - Math.floor(progress));
        const y0 = wordTops[idx] ?? 0;
        const y1 = wordTops[nextIdx] ?? y0;
        targetY = y0 + (y1 - y0) * frac;
    }
    const translateY = focalY - targetY;
    const readIndex = Math.floor(progress);

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
                style={{
                    maxWidth: 'var(--reading-max-width)',
                    transform: `translate3d(0, ${translateY}px, 0)`
                }}
            >
                <div className="space-y-6">
                    {paragraphs.map((para, p) => (
                        <p
                            key={p}
                            style={{
                                fontFamily: 'var(--reading-font)',
                                fontSize: 'var(--reading-prose-size)',
                                lineHeight: 'var(--reading-line-height)',
                                letterSpacing: 'var(--reading-letter-spacing)',
                                wordSpacing: 'var(--reading-word-spacing)',
                                textAlign: 'var(--reading-align)',
                                marginBottom: 'var(--reading-paragraph-gap)'
                            }}
                        >
                            {para.map(({ word, index }) => {
                                const isRead = index < readIndex;
                                const mid = Math.max(1, Math.round(word.length * bionicStrength));
                                return (
                                    // Clicking a word is a mouse shortcut; [ and ] are the keyboard path.
                                    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                                    <span
                                        key={index}
                                        ref={(el) => { wordRefs.current[index] = el; }}
                                        onClick={onWordClick ? () => onWordClick(index) : undefined}
                                        className={`transition-opacity duration-200 ${onWordClick ? 'cursor-pointer hover:underline' : ''}`}
                                        style={{ color: 'var(--reading-fg)', opacity: isRead && dimRead ? 0.4 : 1 }}
                                    >
                                        {bionicReading && word.length > 1
                                            ? <><strong style={{ fontWeight: 700 }}>{word.slice(0, mid)}</strong><span style={{ opacity: 0.78 }}>{word.slice(mid)}</span></>
                                            : word}{' '}
                                    </span>
                                );
                            })}
                        </p>
                    ))}
                </div>
            </div>
        </div>
    );
}
