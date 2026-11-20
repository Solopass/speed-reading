import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Paragraph } from './PacedText';
import { buildChunks, chunkIndexAt, pauseAfter, tokenize, wordWeights } from '../lib/chunker';
import {
    advanceByCost, gradientAnchors, gradientBackground, layoutLines, pacingCosts, textLooks
} from '../lib/textColor';
import { groupLineTops, isHeadingParagraph } from '../lib/scrollUtils';
import { DEFAULT_READING, LIMITS } from '../lib/readingStyle';

/** Word centres (for the scroll) and boxes (for the line gradient), relative to the text column. */
function measureWords(container, wordEls, needBoxes = false) {
    if (!container) return { tops: [], lineTops: [], boxes: [], width: 1 };
    const base = container.getBoundingClientRect();
    const tops = [];
    const boxes = needBoxes ? [] : null;
    for (const el of wordEls) {
        if (!el) {
            tops.push(0);
            if (boxes) boxes.push(null);
            continue;
        }
        const r = el.getBoundingClientRect();
        tops.push(r.top - base.top + r.height / 2);
        if (boxes) boxes.push({ top: r.top - base.top, left: r.left - base.left, right: r.right - base.left });
    }
    return { tops, lineTops: groupLineTops(tops), boxes: boxes ?? [], width: base.width };
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
    rank = null,
    bionicReading = false,
    initialIndex = 0,
    seek = null,
    onWordClick,
    onProgress,
    onComplete,
    onChangeWidth = null,
    onChangeFocalPct = null,
    onChangeHeightVh = null
}) {
    const {
        bionicStrength, dimRead, readOpacity, scrollFocalPct: focalPct, scrollColor, scrollPalette, scrollColorStrength,
        scrollFadeFunctionWords, scrollMarker, scrollGuide, scrollBandLines, scrollSpotlight, scrollEdgeFade,
        scrollTunnel, scrollHeightVh, scrollMotion, scrollPacing, rarityPacing
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
    const wordLineTopsRef = useRef([]);

    const paragraphs = useMemo(() => {
        const paras = text.trim().split(/\n\s*\n/).filter(p => p.trim());
        let index = 0;
        return paras.map(p => p.trim().split(/\s+/).map(word => ({ word, index: index++ })));
    }, [text]);

    const paraHeadings = useMemo(() => paragraphs.map(isHeadingParagraph), [paragraphs]);

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
        return pacingCosts(words, wordWeights(words, rarityPacing ? rank : null), pauses);
    }, [text, words, scrollPacing, rarityPacing, rank]);
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
        const lineTops = wordLineTopsRef.current;
        const content = contentRef.current;
        if (!content) return;
        let targetY = 0;
        if (tops.length > 0) {
            const idx = Math.max(0, Math.min(tops.length - 1, Math.floor(progress)));
            const y0 = tops[idx] ?? 0;
            if (motionRef.current === 'line') {
                targetY = lineTops[idx] ?? y0;
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
            const needBoxes = scrollColor === 'gradient';
            const m = measureWords(contentRef.current, wordRefs.current, needBoxes);
            wordTopsRef.current = m.tops;
            wordLineTopsRef.current = m.lineTops;
            if (needBoxes) {
                setLayout(prev => {
                    const key = m.boxes.map(b => (b ? `${Math.round(b.top)}:${Math.round(b.left)}` : '-')).join(',') + `|${Math.round(m.width)}`;
                    return prev?.key === key ? prev : { key, boxes: m.boxes, width: m.width };
                });
            }
            paint(progressRef.current);
        };
        measure();
        const observer = new ResizeObserver(measure);
        if (viewportRef.current) observer.observe(viewportRef.current);
        if (contentRef.current) observer.observe(contentRef.current);
        document.fonts?.ready.then(measure).catch(() => {});
        return () => observer.disconnect();
    }, [paragraphs, bionicReading, totalWords, paint, layoutKey, scrollColor]);

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

    const [draggingWidth, setDraggingWidth] = useState(false);
    const [draggingFocal, setDraggingFocal] = useState(false);
    const [draggingHeight, setDraggingHeight] = useState(false);
    const dragRef = useRef(null);
    const focalDragRef = useRef(null);
    const heightDragRef = useRef(null);
    const touchScrubRef = useRef(null);

    useEffect(() => {
        const el = viewportRef.current;
        if (!el || totalWords === 0) return undefined;
        const onWheel = (e) => {
            if (Math.abs(e.deltaY) < 4) return;
            e.preventDefault();
            e.stopPropagation();
            const step = e.deltaY > 0 ? Math.max(2, Math.round(e.deltaY / 18)) : -Math.max(2, Math.round(-e.deltaY / 18));
            const next = Math.max(0, Math.min(totalWords - 1, Math.round(progressRef.current) + step));
            if (onWordClick) onWordClick(next);
            else moveTo(next);
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [totalWords, onWordClick, moveTo]);

    const startFocalDrag = (e) => {
        if (!onChangeFocalPct || !viewportRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = viewportRef.current.getBoundingClientRect();
        focalDragRef.current = { startY: e.clientY, startPct: focalPct, height: Math.max(1, rect.height) };
        setDraggingFocal(true);
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };

    const moveFocalDrag = (e) => {
        const d = focalDragRef.current;
        if (!d || !onChangeFocalPct) return;
        const deltaPct = ((e.clientY - d.startY) / d.height) * 100;
        const [minPct, maxPct] = LIMITS.scrollFocalPct;
        const next = Math.round(Math.min(maxPct, Math.max(minPct, d.startPct + deltaPct)));
        onChangeFocalPct(next);
    };

    const endFocalDrag = (e) => {
        if (!focalDragRef.current) return;
        focalDragRef.current = null;
        setDraggingFocal(false);
        e.currentTarget.releasePointerCapture?.(e.pointerId);
    };

    const nudgeFocalKey = (e) => {
        if (!onChangeFocalPct) return;
        const [minPct, maxPct] = LIMITS.scrollFocalPct;
        if (e.key === 'ArrowUp') { e.preventDefault(); onChangeFocalPct(Math.max(minPct, focalPct - 2)); }
        if (e.key === 'ArrowDown') { e.preventDefault(); onChangeFocalPct(Math.min(maxPct, focalPct + 2)); }
    };

    const startHeightDrag = (e) => {
        if (!onChangeHeightVh) return;
        e.preventDefault();
        e.stopPropagation();
        heightDragRef.current = { startY: e.clientY, startVh: scrollHeightVh, vhPx: Math.max(1, window.innerHeight / 100) };
        setDraggingHeight(true);
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };

    const moveHeightDrag = (e) => {
        const d = heightDragRef.current;
        if (!d || !onChangeHeightVh) return;
        const deltaVh = (e.clientY - d.startY) / d.vhPx;
        const [minVh, maxVh] = LIMITS.scrollHeightVh;
        onChangeHeightVh(Math.round(Math.min(maxVh, Math.max(minVh, d.startVh + deltaVh))));
    };

    const endHeightDrag = (e) => {
        if (!heightDragRef.current) return;
        heightDragRef.current = null;
        setDraggingHeight(false);
        e.currentTarget.releasePointerCapture?.(e.pointerId);
    };

    const nudgeHeightKey = (e) => {
        if (!onChangeHeightVh) return;
        const [minVh, maxVh] = LIMITS.scrollHeightVh;
        if (e.key === 'ArrowUp') { e.preventDefault(); onChangeHeightVh(Math.max(minVh, scrollHeightVh - 5)); }
        if (e.key === 'ArrowDown') { e.preventDefault(); onChangeHeightVh(Math.min(maxVh, scrollHeightVh + 5)); }
    };

    const onTouchStartScroll = (e) => {
        if (e.touches.length !== 1) return;
        touchScrubRef.current = { y: e.touches[0].clientY, x: e.touches[0].clientX, startIdx: progressRef.current };
    };

    const onTouchMoveScroll = (e) => {
        const t = touchScrubRef.current;
        if (!t || e.touches.length !== 1 || totalWords === 0) return;
        const dy = t.y - e.touches[0].clientY;
        const dx = Math.abs(t.x - e.touches[0].clientX);
        if (Math.abs(dy) < 10 || dx > Math.abs(dy)) return;
        const wordsDelta = Math.round(dy / 10);
        const next = Math.max(0, Math.min(totalWords - 1, Math.round(t.startIdx) + wordsDelta));
        if (onWordClick) onWordClick(next);
        else moveTo(next);
    };

    const onTouchEndScroll = () => { touchScrubRef.current = null; };

    const startWidthDrag = (side, e) => {
        if (!onChangeWidth || !contentRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = contentRef.current.getBoundingClientRect();
        const startCh = reading.maxWidthCh ?? DEFAULT_READING.maxWidthCh;
        const pxPerCh = rect.width > 0 ? rect.width / Math.max(1, startCh) : 9;
        dragRef.current = { startX: e.clientX, startCh, pxPerCh, side };
        setDraggingWidth(true);
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };

    const moveWidthDrag = (e) => {
        const d = dragRef.current;
        if (!d || !onChangeWidth) return;
        const dx = (e.clientX - d.startX) * (d.side === 'left' ? -1 : 1);
        // Column is centered, so moving one edge by dx changes total width by 2*dx.
        const deltaCh = (dx * 2) / d.pxPerCh;
        const [minCh, maxCh] = LIMITS.maxWidthCh;
        const next = Math.round(Math.min(maxCh, Math.max(minCh, d.startCh + deltaCh)));
        onChangeWidth(next);
    };

    const endWidthDrag = (e) => {
        if (!dragRef.current) return;
        dragRef.current = null;
        setDraggingWidth(false);
        e.currentTarget.releasePointerCapture?.(e.pointerId);
    };

    const nudgeWidthKey = (e) => {
        if (!onChangeWidth) return;
        const [minCh, maxCh] = LIMITS.maxWidthCh;
        const cur = reading.maxWidthCh ?? DEFAULT_READING.maxWidthCh;
        if (e.key === 'ArrowLeft') { e.preventDefault(); onChangeWidth(Math.max(minCh, cur - 2)); }
        if (e.key === 'ArrowRight') { e.preventDefault(); onChangeWidth(Math.min(maxCh, cur + 2)); }
    };

    return (
        <div
            ref={viewportRef}
            onTouchStart={onTouchStartScroll}
            onTouchMove={onTouchMoveScroll}
            onTouchEnd={onTouchEndScroll}
            className="relative w-full overflow-hidden select-none group/scroll"
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
                    className={`absolute inset-x-0 pointer-events-none border-y transition-colors ${draggingFocal ? 'border-purple-400/60 bg-purple-500/10' : 'border-purple-500/20 bg-purple-500/[0.05]'}`}
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
            {onChangeFocalPct && (
                <div
                    role="slider"
                    aria-label="Drag to move reading line"
                    aria-valuemin={LIMITS.scrollFocalPct[0]}
                    aria-valuemax={LIMITS.scrollFocalPct[1]}
                    aria-valuenow={focalPct}
                    tabIndex={0}
                    onPointerDown={startFocalDrag}
                    onPointerMove={moveFocalDrag}
                    onPointerUp={endFocalDrag}
                    onPointerCancel={endFocalDrag}
                    onDoubleClick={() => onChangeFocalPct(DEFAULT_READING.scrollFocalPct)}
                    onKeyDown={nudgeFocalKey}
                    title="Drag up/down to move reading line (double-click to reset)"
                    style={{ top: focalY, transform: 'translateY(-50%)' }}
                    className="hidden sm:flex items-center justify-center absolute right-1.5 w-5 h-7 cursor-ns-resize z-20 opacity-0 group-hover/scroll:opacity-100 focus:opacity-100 transition-opacity touch-none"
                >
                    <span className={`w-3.5 h-1 rounded-full transition-colors ${draggingFocal ? 'bg-purple-400' : 'bg-slate-600 hover:bg-purple-400'}`} />
                </div>
            )}

            <div
                className={`relative mx-auto w-full ${draggingWidth ? 'ring-1 ring-purple-500/40 rounded-lg' : ''}`}
                style={{ maxWidth: 'var(--reading-max-width)' }}
            >
                {onChangeWidth && (
                    <>
                        <div
                            role="slider"
                            aria-label="Drag to resize scroll width"
                            aria-valuemin={LIMITS.maxWidthCh[0]}
                            aria-valuemax={LIMITS.maxWidthCh[1]}
                            aria-valuenow={reading.maxWidthCh}
                            tabIndex={0}
                            onPointerDown={(e) => startWidthDrag('left', e)}
                            onPointerMove={moveWidthDrag}
                            onPointerUp={endWidthDrag}
                            onPointerCancel={endWidthDrag}
                            onKeyDown={nudgeWidthKey}
                            title="Drag to resize width"
                            className="hidden sm:flex items-center justify-center absolute -left-4 top-0 bottom-0 w-4 cursor-ew-resize z-20 opacity-0 group-hover/scroll:opacity-100 focus:opacity-100 transition-opacity touch-none"
                        >
                            <span className={`w-1 h-16 rounded-full transition-colors ${draggingWidth ? 'bg-purple-400' : 'bg-slate-600 hover:bg-purple-400'}`} />
                        </div>
                        <div
                            role="slider"
                            aria-label="Drag to resize scroll width"
                            aria-valuemin={LIMITS.maxWidthCh[0]}
                            aria-valuemax={LIMITS.maxWidthCh[1]}
                            aria-valuenow={reading.maxWidthCh}
                            tabIndex={0}
                            onPointerDown={(e) => startWidthDrag('right', e)}
                            onPointerMove={moveWidthDrag}
                            onPointerUp={endWidthDrag}
                            onPointerCancel={endWidthDrag}
                            onKeyDown={nudgeWidthKey}
                            title="Drag to resize width"
                            className="hidden sm:flex items-center justify-center absolute -right-4 top-0 bottom-0 w-4 cursor-ew-resize z-20 opacity-0 group-hover/scroll:opacity-100 focus:opacity-100 transition-opacity touch-none"
                        >
                            <span className={`w-1 h-16 rounded-full transition-colors ${draggingWidth ? 'bg-purple-400' : 'bg-slate-600 hover:bg-purple-400'}`} />
                        </div>
                    </>
                )}

                <div
                    ref={contentRef}
                    className="w-full will-change-transform"
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
                            readOpacity={readOpacity}
                            bionicReading={bionicReading}
                            bionicStrength={bionicStrength}
                            onWordClick={onWordClick}
                            setRef={setRef}
                            looks={looks}
                            isHeading={paraHeadings[p]}
                        />
                    );
                })}
                </div>
            </div>

            {(draggingWidth || draggingFocal || draggingHeight) && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-2.5 py-1 rounded-full bg-purple-600 text-white text-xs font-mono font-bold shadow-lg pointer-events-none">
                    {draggingWidth ? `${reading.maxWidthCh} ch` : draggingFocal ? `${focalPct}% down` : `${scrollHeightVh}vh`}
                </div>
            )}

            {/* Horizontal focus tunnel: optional left/right edge fade to narrow peripheral distraction. */}
            {scrollTunnel > 0 && (
                <>
                    <div
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 pointer-events-none"
                        style={{
                            width: `${scrollTunnel}%`,
                            background: 'linear-gradient(to right, var(--reading-bg) 0%, transparent 100%)'
                        }}
                    />
                    <div
                        aria-hidden="true"
                        className="absolute inset-y-0 right-0 pointer-events-none"
                        style={{
                            width: `${scrollTunnel}%`,
                            background: 'linear-gradient(to left, var(--reading-bg) 0%, transparent 100%)'
                        }}
                    />
                </>
            )}

            {onChangeHeightVh && (
                <div
                    role="slider"
                    aria-label="Drag to resize scroll height"
                    aria-valuemin={LIMITS.scrollHeightVh[0]}
                    aria-valuemax={LIMITS.scrollHeightVh[1]}
                    aria-valuenow={scrollHeightVh}
                    tabIndex={0}
                    onPointerDown={startHeightDrag}
                    onPointerMove={moveHeightDrag}
                    onPointerUp={endHeightDrag}
                    onPointerCancel={endHeightDrag}
                    onDoubleClick={() => onChangeHeightVh(DEFAULT_READING.scrollHeightVh)}
                    onKeyDown={nudgeHeightKey}
                    title="Drag bottom edge to resize height (double-click to reset)"
                    className="hidden sm:flex items-center justify-center absolute inset-x-0 bottom-0 h-3.5 cursor-ns-resize z-20 opacity-0 group-hover/scroll:opacity-100 focus:opacity-100 transition-opacity touch-none"
                >
                    <span className={`h-1 w-16 rounded-full transition-colors ${draggingHeight ? 'bg-purple-400' : 'bg-slate-600 hover:bg-purple-400'}`} />
                </div>
            )}

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
