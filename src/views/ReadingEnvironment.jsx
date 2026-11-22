import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pause, Play, Type } from 'lucide-react';
import { estimatedWordsPerLine, focalColorFor, normalizeReading } from '../lib/readingStyle';
import { focalRange } from '../lib/scrollUtils';
import { buildChunks, joinFlashWords } from '../lib/chunker';
import ReaderSettings from '../components/ReaderSettings';
import ReadingSurface, { proseStyle } from '../components/ReadingSurface';
import ScrollText from '../components/ScrollText';

const SAMPLE = `The eye does not glide smoothly across a line of text. It moves in short jumps called saccades, pausing between them at fixation points where the reading actually happens.

Tune this page until a line feels like one comfortable sweep rather than a journey. That is the setting worth training on.`;

// A longer sample for the moving previews, so they have something to scroll and flash through.
const LONG_SAMPLE = `${SAMPLE}

Every fixation takes in a small window of letters, sharpest at the centre and fading quickly to either side. Fast readers do not move their eyes faster; they take in more of each window and go back less often.

That is why the shape of the text matters. A line that is too long makes the return sweep miss; letters packed too tightly blur into one another; a page that is too bright tires the eyes before the mind. Small changes here add up over a long chapter.

When the settings feel right, open a document and read. The reader uses exactly what you see in this preview.`;

const PREVIEW_WPM = 300;

/** The flash preview: one word with its focal letter, or a phrase when more words per flash are set. */
function FlashPreview({ reading, chunkSize, word, playing }) {
    const words = useMemo(() => LONG_SAMPLE.trim().split(/\s+/), []);
    const chunks = useMemo(() => buildChunks(LONG_SAMPLE, { maxWords: chunkSize }), [chunkSize]);
    const [k, setK] = useState(0);
    useEffect(() => {
        if (!playing || chunks.length === 0) return undefined;
        const c = chunks[k % chunks.length];
        const ms = (60000 / PREVIEW_WPM) * (c.end - c.start) + 120;
        const t = setTimeout(() => setK(i => (i + 1) % chunks.length), ms);
        return () => clearTimeout(t);
    }, [playing, k, chunks]);

    const focal = focalColorFor(reading);
    // Paused, it shows your own word; playing, it runs through the sample.
    const group = playing && chunks.length ? words.slice(chunks[k % chunks.length].start, chunks[k % chunks.length].end) : [word];

    if (group.length > 1) {
        return (
            <div className="text-center py-6" style={{ fontSize: 'calc(var(--reading-rsvp-size) * 0.6)', fontFamily: 'var(--reading-font)', fontWeight: reading.rsvpWeight, lineHeight: 1.2 }}>
                {joinFlashWords(group)}
            </div>
        );
    }

    const w = group[0] ?? '';
    const range = focalRange(w, reading.focalSpan);
    const isGrad = reading.focalSpan === 'gradient';
    const pre = w.slice(0, range.start);
    const leftCluster = w.slice(range.start, range.center);
    const center = w.charAt(range.center);
    const rightCluster = w.slice(range.center + 1, range.end);
    const post = w.slice(range.end);
    return (
        <div className="flex items-center justify-center py-6 relative" style={{ fontSize: 'var(--reading-rsvp-size)', fontFamily: 'var(--reading-font)', fontWeight: reading.rsvpWeight, lineHeight: 1.1 }}>
            {reading.showFocalGuide && (
                <div className="absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2" style={{ background: 'var(--reading-muted)', opacity: 0.35 }} />
            )}
            <span className="flex-1 text-right whitespace-pre" style={{ opacity: reading.rsvpFlankOpacity ?? 0.8 }}>
                {isGrad && focal ? <span style={{ color: focal, opacity: 0.55 }}>{pre}</span> : pre}
                {leftCluster && <span className="font-bold" style={{ color: focal ?? 'inherit', opacity: 0.85 }}>{leftCluster}</span>}
            </span>
            <span className="shrink-0 font-bold" style={{ color: focal ?? 'inherit' }}>{center}</span>
            <span className="flex-1 text-left whitespace-pre" style={{ opacity: reading.rsvpFlankOpacity ?? 0.8 }}>
                {rightCluster && <span className="font-bold" style={{ color: focal ?? 'inherit', opacity: 0.85 }}>{rightCluster}</span>}
                {isGrad && focal ? <span style={{ color: focal, opacity: 0.55 }}>{post}</span> : post}
            </span>
        </div>
    );
}

/**
 * Reading Setup: the same settings as the reader's drawer (one set of
 * controls, so the two cannot drift apart), laid out as a page, with a live
 * preview beside them that shows whichever mode the open tab is about.
 */
function ReadingEnvironment({ reading, patchReading, settings, updateSettings, customPresets, onSavePresets }) {
    const current = normalizeReading(reading);
    const [tab, setTab] = useState('rsvp');
    const [word, setWord] = useState('recalibrating');
    const [playing, setPlaying] = useState(false);
    // Bumped when the scroll preview reaches the end, so the next Play starts over.
    const [scrollRun, setScrollRun] = useState(0);
    // Changing tab stops the moving preview.
    const changeTab = useCallback((next) => { setTab(next); setPlaying(false); }, [setTab, setPlaying]);

    const previewMode = tab === 'rsvp' ? 'rsvp' : tab === 'scroll' ? 'scroll' : 'page';
    const canPlay = previewMode !== 'page';
    // The window height setting is honoured but capped, so the preview fits beside the controls.
    const scrollPreviewReading = { ...current, scrollHeightVh: Math.min(current.scrollHeightVh, 45) };

    return (
        <div className="max-w-6xl mx-auto space-y-6 animate-in slide-in-from-bottom-4 pb-12">
            <div>
                <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                    <Type className="text-purple-500 w-7 h-7" /> Reading Setup
                </h1>
                <p className="text-slate-400 mt-2 max-w-3xl">
                    How text is set changes how fast you can read it. These are the same settings as the reader&apos;s settings
                    drawer, so changes here show up in every mode and the other way round.
                </p>
            </div>

            <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-6 items-start">
                <div className="lg:order-2 lg:sticky lg:top-4 space-y-3">
                    <ReadingSurface reading={current} className="rounded-3xl border border-slate-800 overflow-hidden">
                        <div className="p-5 md:p-6">
                            <div className="flex items-center justify-between mb-3 gap-2">
                                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--reading-muted)' }}>
                                    Live preview · {previewMode === 'rsvp' ? 'Speed Reader' : previewMode === 'scroll' ? 'Scroll' : 'Page'}
                                </span>
                                <span className="flex items-center gap-3">
                                    <span className="text-[11px] font-mono" style={{ color: 'var(--reading-muted)' }}>
                                        ~{estimatedWordsPerLine(current)} words per line · {current.maxWidthCh}ch
                                    </span>
                                    {canPlay && (
                                        <button
                                            type="button" onClick={() => setPlaying(p => !p)}
                                            aria-label={playing ? 'Pause preview' : 'Play preview'}
                                            className="p-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white"
                                        >
                                            {playing ? <Pause size={13} /> : <Play size={13} />}
                                        </button>
                                    )}
                                </span>
                            </div>

                            {previewMode === 'rsvp' && (
                                <FlashPreview reading={current} chunkSize={settings.chunkSize ?? 1} word={word || 'recalibrating'} playing={playing} />
                            )}
                            {previewMode === 'scroll' && (
                                <ScrollText
                                    key={scrollRun} text={LONG_SAMPLE} wpm={PREVIEW_WPM} isRunning={playing}
                                    reading={scrollPreviewReading} bionicReading={settings.bionicReading}
                                    onComplete={() => { setPlaying(false); setScrollRun(n => n + 1); }}
                                />
                            )}
                            {previewMode === 'page' && (
                                <div className="mx-auto" style={{ maxWidth: 'var(--reading-max-width)' }}>
                                    {SAMPLE.split('\n\n').map((para, i) => (
                                        <p key={i} style={{ ...proseStyle, marginBottom: 'var(--reading-paragraph-gap)' }}>{para}</p>
                                    ))}
                                </div>
                            )}
                        </div>
                    </ReadingSurface>

                    {previewMode === 'rsvp' && (
                        <label className="block bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3">
                            <span className="text-xs font-bold text-slate-400">Try your own word (shown while paused)</span>
                            <input
                                value={word} onChange={(e) => setWord(e.target.value.replace(/\s+/g, ''))}
                                className="mt-1.5 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                            />
                        </label>
                    )}
                </div>

                <div className="lg:order-1 min-w-0">
                    <ReaderSettings
                        variant="page"
                        open
                        reading={current}
                        patchReading={patchReading}
                        settings={settings}
                        updateSettings={updateSettings}
                        mode="rsvp"
                        customPresets={customPresets}
                        onSavePresets={onSavePresets}
                        onTabChange={changeTab}
                    />
                </div>
            </div>
        </div>
    );
}

export default ReadingEnvironment;
