import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

function locateCursor(lines, progress) {
    if (!lines.length) return null;
    let consumed = 0;
    for (const line of lines) {
        if (progress < consumed + line.count) {
            const within = (progress - consumed) / line.count;
            return {
                x: line.left + within * (line.right - line.left),
                top: line.top,
                height: line.height,
                left: line.left,
                right: line.right
            };
        }
        consumed += line.count;
    }
    const last = lines[lines.length - 1];
    return { x: last.right, top: last.top, height: last.height, left: last.left, right: last.right };
}

const PARAGRAPH_STYLE = {
    fontFamily: 'var(--reading-font)',
    fontSize: 'var(--reading-prose-size)',
    lineHeight: 'var(--reading-line-height)',
    letterSpacing: 'var(--reading-letter-spacing)',
    wordSpacing: 'var(--reading-word-spacing)',
    textAlign: 'var(--reading-align)',
    marginBottom: 'var(--reading-paragraph-gap)'
};

/**
 * One paragraph of words. Memoised and given a read position clamped to its
 * own range, so as the pacer moves only the paragraph the cursor is in
 * re-renders, not every word in a long chapter.
 */
export const Paragraph = memo(function Paragraph({
    para, readUntil, currentIndex, currentEnd, dimRead, bionicReading, bionicStrength, onWordClick, setRef, looks = null,
    readOpacity = 0.45
}) {
    // The highlighted stretch: one word by default, or a phrase [currentIndex, currentEnd).
    const hiEnd = currentEnd ?? currentIndex + 1;
    return (
        <p style={PARAGRAPH_STYLE}>
            {para.map(({ word, index }) => {
                const isRead = index < readUntil;
                const isCurrent = currentIndex >= 0 && index >= currentIndex && index < hiEnd;
                const mid = Math.max(1, Math.round(word.length * bionicStrength));
                const look = looks?.[index];
                const opacity = (isRead && dimRead ? readOpacity : 1) * (look?.fade ? 0.5 : 1);
                return (
                    // Clicking a word is a mouse shortcut for jumping there; the
                    // keyboard path is [ and ] in the reader.
                    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                    <span
                        key={index}
                        ref={(el) => setRef(index, el)}
                        onClick={onWordClick ? () => onWordClick(index) : undefined}
                        className={`transition-opacity duration-300 ${onWordClick ? 'cursor-pointer' : ''}`}
                        style={{
                            color: look?.bg ? 'transparent' : (look?.color ?? 'var(--reading-fg)'),
                            // A line gradient paints the letters themselves.
                            ...(look?.bg ? { backgroundImage: look.bg, WebkitBackgroundClip: 'text', backgroundClip: 'text' } : null),
                            // An inset shadow rather than a background, which a gradient would clip to the letters.
                            boxShadow: isCurrent ? 'inset 0 0 0 999px rgba(168, 85, 247, 0.22)' : undefined,
                            // A highlighted phrase reads as one block: rounded only at its ends.
                            borderRadius: isCurrent
                                ? `${index === currentIndex ? 4 : 0}px ${index === hiEnd - 1 ? 4 : 0}px ${index === hiEnd - 1 ? 4 : 0}px ${index === currentIndex ? 4 : 0}px`
                                : 4,
                            opacity
                        }}
                    >
                        {bionicReading && word.length > 1 ? (
                            <><strong style={{ color: 'inherit' }}>{word.slice(0, mid)}</strong>{word.slice(mid)}</>
                        ) : word}
                        {' '}
                    </span>
                );
            })}
        </p>
    );
});

/**
 * A guided pacer: text stays in its normal layout while a cursor sweeps each
 * line at the target speed.
 *
 * This exists because RSVP, for all its speed, trains a skill you can only use
 * inside this app — you cannot flash words one at a time out of a book. A pacer
 * suppresses regression and sets tempo while leaving your eyes to make real
 * saccades across real lines, which is what transfers to reading off a page.
 *
 * Performance: the cursor moves every animation frame, but those frames write
 * its position straight to the DOM. React state changes only when the current
 * word changes, so a long chapter is not re-rendered sixty times a second.
 */
export default function PacedText({
    text,
    wpm,
    isRunning,
    bionicReading = false,
    bionicStrength = 0.5,
    pacerStyle = 'band',
    dimRead = true,
    readOpacity = 0.45,
    initialIndex = 0,
    seek = null,          // { index, nonce }: jump the cursor to a word
    onWordClick,
    onProgress,
    onComplete
}) {
    const containerRef = useRef(null);
    const wordRefs = useRef([]);
    const bandRef = useRef(null);
    const cursorRef = useRef(null);
    const underlineRef = useRef(null);
    const linesRef = useRef([]);

    // Paragraphs preserved for layout, but word indices run continuously across
    // them so the pacer can treat the passage as one stream.
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
    const progressRef = useRef(clampedInitial);   // fractional word index, per frame
    const [readIndex, setReadIndex] = useState(Math.floor(clampedInitial));
    const readIndexRef = useRef(Math.floor(clampedInitial));

    const setRef = useCallback((index, el) => { wordRefs.current[index] = el; }, []);

    /** Moves the band, cursor and underline to `progress` without a React render. */
    const paint = useCallback((progress) => {
        const c = locateCursor(linesRef.current, progress);
        const band = bandRef.current;
        const cursor = cursorRef.current;
        const underline = underlineRef.current;
        if (band) {
            band.style.display = c ? '' : 'none';
            if (c) Object.assign(band.style, { top: `${c.top - 4}px`, left: `${c.left - 8}px`, width: `${c.right - c.left + 16}px`, height: `${c.height + 8}px` });
        }
        if (cursor) {
            cursor.style.display = c ? '' : 'none';
            if (c) Object.assign(cursor.style, { top: `${c.top - 2}px`, left: `${c.x}px`, height: `${c.height + 4}px` });
        }
        if (underline) {
            underline.style.display = c ? '' : 'none';
            if (c) Object.assign(underline.style, { top: `${c.top + c.height}px`, left: `${Math.max(c.left, c.x - 90)}px`, width: `${Math.max(4, Math.min(90, c.x - c.left))}px` });
        }
    }, []);

    /** Sets the position (seek, initial placement or a frame) and syncs the word-level state. */
    const moveTo = useCallback((progress) => {
        progressRef.current = progress;
        paint(progress);
        const ri = Math.floor(progress);
        if (ri !== readIndexRef.current) {
            readIndexRef.current = ri;
            setReadIndex(ri);
        }
    }, [paint]);

    // Group word spans into visual lines by their vertical position. Reading
    // this from the DOM rather than guessing means the pacer follows real
    // wrapping at any width or font size.
    useLayoutEffect(() => {
        const measure = () => {
            const container = containerRef.current;
            if (!container) return;
            wordRefs.current.length = totalWords;
            const base = container.getBoundingClientRect();
            const grouped = [];

            wordRefs.current.forEach((el, i) => {
                if (!el) return;
                const r = el.getBoundingClientRect();
                const top = r.top - base.top;
                const last = grouped[grouped.length - 1];

                // Same line if the baselines are within a few pixels.
                if (last && Math.abs(last.top - top) < 6) {
                    last.right = r.right - base.left;
                    last.count += 1;
                } else {
                    grouped.push({
                        top,
                        height: r.height,
                        left: r.left - base.left,
                        right: r.right - base.left,
                        start: i,
                        count: 1
                    });
                }
            });

            linesRef.current = grouped;
            paint(progressRef.current);
        };

        measure();
        const observer = new ResizeObserver(measure);
        if (containerRef.current) observer.observe(containerRef.current);
        // Font loading can reflow the text after the first measure.
        document.fonts?.ready.then(measure).catch(() => {});
        return () => observer.disconnect();
    }, [paragraphs, bionicReading, totalWords, paint]);

    // A different pacer style mounts different guide elements; place them.
    useLayoutEffect(() => { paint(progressRef.current); }, [pacerStyle, paint]);

    useEffect(() => {
        let cancelled = false;
        const startAt = Math.max(0, Math.min(totalWords, initialIndex));
        queueMicrotask(() => {
            if (cancelled) return;
            moveTo(startAt);
            if (startAt > 0) {
                wordRefs.current[Math.min(startAt, Math.max(0, totalWords - 1))]?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
            }
        });
        return () => { cancelled = true; };
    }, [text, initialIndex, totalWords, moveTo]);

    // An external jump (rewind, skip, click on the progress bar). Keyed on a
    // nonce so jumping to the same word twice still moves the cursor.
    useEffect(() => {
        if (!seek) return undefined;
        let cancelled = false;
        const index = Math.max(0, Math.min(totalWords, seek.index));
        queueMicrotask(() => {
            if (cancelled) return;
            moveTo(index);
            wordRefs.current[Math.min(index, Math.max(0, totalWords - 1))]?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        });
        return () => { cancelled = true; };
    }, [seek, totalWords, moveTo]);

    // Time-based rather than per-frame increments, so the pace stays honest
    // when the browser throttles frames.
    useEffect(() => {
        if (!isRunning || totalWords === 0) return undefined;

        let frame;
        let last = performance.now();

        const tick = (now) => {
            // Clamped because returning from a background tab hands back one
            // enormous delta, which would otherwise teleport the cursor to the
            // end of the passage.
            const delta = Math.min(100, now - last);
            last = now;
            const next = Math.min(totalWords, progressRef.current + (delta / 60000) * wpm);
            moveTo(next);
            if (next < totalWords) frame = requestAnimationFrame(tick);
        };

        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [isRunning, wpm, totalWords, moveTo]);

    // Completion is reported from an effect rather than inside the animation
    // loop, so the callback never fires during a state update.
    useEffect(() => {
        if (totalWords > 0 && readIndex >= totalWords) onComplete?.();
    }, [readIndex, totalWords, onComplete]);

    useEffect(() => { onProgress?.(readIndex); }, [readIndex, onProgress]);

    const currentWord = pacerStyle === 'word' ? readIndex : -1;

    return (
        <div ref={containerRef} className="relative mx-auto" style={{ maxWidth: 'var(--reading-max-width)' }}>
            {(pacerStyle === 'band' || pacerStyle === 'line') && (
                // Band over the active line; the 'band' style adds the sweeping cursor.
                <div ref={bandRef} className="absolute rounded-lg bg-purple-500/10 pointer-events-none transition-[top] duration-150" style={{ display: 'none' }} />
            )}
            {pacerStyle === 'band' && (
                <div ref={cursorRef} className="absolute w-0.5 bg-purple-400 pointer-events-none shadow-[0_0_12px_2px_rgba(168,85,247,0.6)]" style={{ display: 'none' }} />
            )}
            {pacerStyle === 'underline' && (
                // A short bar trailing just behind the cursor, under the text.
                <div ref={underlineRef} className="absolute h-1 rounded-full bg-purple-500 pointer-events-none" style={{ display: 'none' }} />
            )}

            <div className="relative space-y-6">
                {paragraphs.map((para, p) => {
                    const start = para[0]?.index ?? 0;
                    const end = start + para.length;
                    return (
                        <Paragraph
                            key={p}
                            para={para}
                            readUntil={Math.max(start, Math.min(end, readIndex))}
                            currentIndex={currentWord >= start && currentWord < end ? currentWord : -1}
                            dimRead={dimRead}
                            readOpacity={readOpacity}
                            bionicReading={bionicReading}
                            bionicStrength={bionicStrength}
                            onWordClick={onWordClick}
                            setRef={setRef}
                        />
                    );
                })}
            </div>
        </div>
    );
}
