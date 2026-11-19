import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

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

/**
 * A guided pacer: text stays in its normal layout while a cursor sweeps each
 * line at the target speed.
 *
 * This exists because RSVP, for all its speed, trains a skill you can only use
 * inside this app — you cannot flash words one at a time out of a book. A pacer
 * suppresses regression and sets tempo while leaving your eyes to make real
 * saccades across real lines, which is what transfers to reading off a page.
 */
export default function PacedText({
    text,
    wpm,
    isRunning,
    bionicReading = false,
    bionicStrength = 0.5,
    pacerStyle = 'band',
    dimRead = true,
    seek = null,          // { index, nonce }: jump the cursor to a word
    onWordClick,
    onProgress,
    onComplete
}) {
    const containerRef = useRef(null);
    const wordRefs = useRef([]);

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

    const [lines, setLines] = useState([]);
    const [progress, setProgress] = useState(0); // fractional word index
    const progressRef = useRef(0);

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

            setLines(grouped);
        };

        measure();
        const observer = new ResizeObserver(measure);
        if (containerRef.current) observer.observe(containerRef.current);
        // Font loading can reflow the text after the first measure.
        document.fonts?.ready.then(measure).catch(() => {});
        return () => observer.disconnect();
    }, [paragraphs, bionicReading, totalWords]);

    useEffect(() => {
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            progressRef.current = 0;
            setProgress(0);
        });
        return () => { cancelled = true; };
    }, [text]);

    // An external jump (rewind, skip, click on the progress bar). Keyed on a
    // nonce so jumping to the same word twice still moves the cursor.
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

    // Time-based rather than per-frame increments, so the pace stays honest
    // when the browser throttles frames.
    useEffect(() => {
        if (!isRunning || totalWords === 0) return;

        let frame;
        let last = performance.now();

        const tick = (now) => {
            // Clamped because returning from a background tab hands back one
            // enormous delta, which would otherwise teleport the cursor to the
            // end of the passage.
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

    // Completion is reported from an effect rather than inside the animation
    // loop, so the callback never fires during a state update.
    useEffect(() => {
        if (totalWords > 0 && progress >= totalWords) onComplete?.();
    }, [progress, totalWords, onComplete]);

    useEffect(() => { onProgress?.(Math.floor(progress)); }, [progress, onProgress]);

    // Locate the cursor: which line holds the current word, and how far along it.
    const cursor = locateCursor(lines, progress);

    const readIndex = Math.floor(progress);

    return (
        <div ref={containerRef} className="relative mx-auto" style={{ maxWidth: "var(--reading-max-width)" }}>
            {cursor && (pacerStyle === 'band' || pacerStyle === 'line') && (
                // Band over the active line; the 'band' style adds the sweeping cursor.
                <div
                    className="absolute rounded-lg bg-purple-500/10 pointer-events-none transition-[top] duration-150"
                    style={{ top: cursor.top - 4, left: cursor.left - 8, width: cursor.right - cursor.left + 16, height: cursor.height + 8 }}
                />
            )}
            {cursor && pacerStyle === 'band' && (
                <div
                    className="absolute w-0.5 bg-purple-400 pointer-events-none shadow-[0_0_12px_2px_rgba(168,85,247,0.6)]"
                    style={{ top: cursor.top - 2, left: cursor.x, height: cursor.height + 4 }}
                />
            )}
            {cursor && pacerStyle === 'underline' && (
                // A short bar trailing just behind the cursor, under the text.
                <div
                    className="absolute h-1 rounded-full bg-purple-500 pointer-events-none"
                    style={{ top: cursor.top + cursor.height, left: Math.max(cursor.left, cursor.x - 90), width: Math.max(4, Math.min(90, cursor.x - cursor.left)) }}
                />
            )}

            <div className="relative space-y-6">
                {paragraphs.map((para, p) => (
                    <p key={p} style={{ fontFamily: "var(--reading-font)", fontSize: "var(--reading-prose-size)", lineHeight: "var(--reading-line-height)", letterSpacing: "var(--reading-letter-spacing)", wordSpacing: "var(--reading-word-spacing)", textAlign: "var(--reading-align)", marginBottom: "var(--reading-paragraph-gap)" }}>
                        {para.map(({ word, index }) => {
                            const isRead = index < readIndex;
                            const isCurrent = pacerStyle === 'word' && index === readIndex;
                            const mid = Math.max(1, Math.round(word.length * bionicStrength));
                            return (
                                // Clicking a word is a mouse shortcut for jumping there; the
                                // keyboard path is [ and ] in the reader.
                                // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                                <span
                                    key={index}
                                    ref={(el) => { wordRefs.current[index] = el; }}
                                    onClick={onWordClick ? () => onWordClick(index) : undefined}
                                    className={`transition-opacity duration-300 rounded ${isCurrent ? 'bg-purple-500/25' : ''} ${onWordClick ? 'cursor-pointer' : ''}`}
                                    style={{ color: "var(--reading-fg)", opacity: isRead && dimRead ? 0.45 : 1 }}
                                >
                                    {bionicReading && word.length > 1 ? (
                                        <><strong style={{ color: "var(--reading-fg)" }}>{word.slice(0, mid)}</strong>{word.slice(mid)}</>
                                    ) : word}
                                    {' '}
                                </span>
                            );
                        })}
                    </p>
                ))}
            </div>
        </div>
    );
}
