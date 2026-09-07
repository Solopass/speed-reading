import { useState } from 'react';
import { RotateCcw, Type } from 'lucide-react';
import {
    DEFAULT_READING, FOCAL_COLORS, FONT_OPTIONS, LIMITS, THEMES,
    estimatedWordsPerLine, focalColorFor, normalizeReading
} from '../lib/readingStyle';
import ReadingSurface, { proseStyle } from '../components/ReadingSurface';

const SAMPLE = `The eye does not glide smoothly across a line of text. It moves in short jumps called saccades, pausing between them at fixation points where the reading actually happens.

Tune this page until a line feels like one comfortable sweep rather than a journey. That is the setting worth training on.`;

function Slider({ label, hint, value, onChange, range, step = 1, format = (v) => v }) {
    const [min, max] = range;
    return (
        <div>
            <label className="flex justify-between items-baseline text-sm font-bold text-slate-300 mb-1.5">
                <span>{label}</span>
                <span className="text-purple-400 font-mono text-xs">{format(value)}</span>
            </label>
            <input
                type="range" min={min} max={max} step={step} value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                aria-label={label}
                className="w-full accent-purple-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
            />
            {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
        </div>
    );
}

function Section({ title, children }) {
    return (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-5">
            <h2 className="text-lg font-bold text-white">{title}</h2>
            {children}
        </div>
    );
}

function ReadingEnvironment({ reading, updateReading }) {
    const current = normalizeReading(reading);
    const [previewWord, setPreviewWord] = useState('recalibrating');
    const set = (patch) => updateReading({ ...current, ...patch });

    const wordsPerLine = estimatedWordsPerLine(current);
    const widthVerdict = current.maxWidthCh < 45
        ? 'Narrow — more return sweeps per paragraph.'
        : current.maxWidthCh > 80
            ? 'Wide — easy to lose your place on the return sweep.'
            : 'In the comfortable band most readers land in.';

    const focal = focalColorFor(current);
    const mid = Math.max(0, Math.floor(previewWord.length / 2) - 1);

    return (
        <div className="max-w-5xl mx-auto space-y-6 animate-in slide-in-from-bottom-4 pb-12">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                        <Type className="text-purple-500 w-7 h-7" /> Reading Setup
                    </h1>
                    <p className="text-slate-400 mt-2 max-w-2xl">
                        How text is set changes how fast you can read it. Line width decides how many saccades a line costs, spacing
                        decides whether your eye finds the next line without slipping back. Tune it here; every mode uses these settings.
                    </p>
                </div>
                <button
                    onClick={() => updateReading({ ...DEFAULT_READING })}
                    className="flex items-center gap-2 text-slate-400 hover:text-white text-sm font-medium border border-slate-800 hover:border-slate-600 px-4 py-2 rounded-xl transition-colors"
                >
                    <RotateCcw size={14} /> Reset
                </button>
            </div>

            {/* Live preview, pinned so it stays visible while the controls scroll. */}
            <ReadingSurface reading={current} className="rounded-3xl border border-slate-800 overflow-hidden sticky top-0 z-10 shadow-xl">
                <div className="p-6 md:p-8">
                    <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--reading-muted)' }}>
                            Live preview
                        </span>
                        <span className="text-[11px] font-mono" style={{ color: 'var(--reading-muted)' }}>
                            ~{wordsPerLine} words per line · {current.maxWidthCh}ch
                        </span>
                    </div>

                    {/* RSVP sample: the focal letter is what your eye locks onto. */}
                    <div
                        className="flex items-center justify-center py-4 mb-6 relative"
                        style={{ fontSize: 'var(--reading-rsvp-size)', fontFamily: 'var(--reading-font)', lineHeight: 1.1 }}
                    >
                        {current.showFocalGuide && (
                            <div className="absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2" style={{ background: 'var(--reading-muted)', opacity: 0.35 }} />
                        )}
                        <span className="flex-1 text-right whitespace-pre" style={{ opacity: 0.8 }}>{previewWord.slice(0, mid)}</span>
                        <span className="shrink-0 font-bold" style={{ color: focal }}>{previewWord.charAt(mid)}</span>
                        <span className="flex-1 text-left whitespace-pre" style={{ opacity: 0.8 }}>{previewWord.slice(mid + 1)}</span>
                    </div>

                    <div className="mx-auto" style={{ maxWidth: 'var(--reading-max-width)' }}>
                        {SAMPLE.split('\n\n').map((para, i) => (
                            <p key={i} style={{ ...proseStyle, marginBottom: 'var(--reading-paragraph-gap)' }}>{para}</p>
                        ))}
                    </div>
                </div>
            </ReadingSurface>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Section title="Typeface">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {FONT_OPTIONS.map(font => (
                            <button
                                key={font.id}
                                onClick={() => set({ fontId: font.id })}
                                style={{ fontFamily: font.stack }}
                                className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                                    current.fontId === font.id
                                        ? 'border-purple-500 bg-purple-950/30 text-white'
                                        : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-600'
                                }`}
                            >
                                <div className="font-bold">{font.label}</div>
                                <div className="text-[11px] opacity-70 mt-0.5">{font.note}</div>
                            </button>
                        ))}
                    </div>
                    <p className="text-[11px] text-slate-500">
                        The last three download on selection; the first three are already on your machine and work offline.
                    </p>
                </Section>

                <Section title="Colour">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {THEMES.map(theme => (
                            <button
                                key={theme.id}
                                onClick={() => set({ themeId: theme.id })}
                                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                                    current.themeId === theme.id ? 'border-purple-500' : 'border-slate-800 hover:border-slate-600'
                                }`}
                                style={{ background: theme.bg, color: theme.fg }}
                            >
                                <span className="w-5 h-5 rounded-full border" style={{ background: theme.fg, borderColor: theme.muted }} />
                                <span className="font-bold text-sm">{theme.label}</span>
                            </button>
                        ))}
                    </div>

                    <div>
                        <div className="text-sm font-bold text-slate-300 mb-2">Focal letter</div>
                        <div className="flex gap-2 flex-wrap">
                            {FOCAL_COLORS.map(colour => (
                                <button
                                    key={colour.id}
                                    onClick={() => set({ focalColorId: colour.id })}
                                    className={`px-3 py-2 rounded-lg border text-xs font-bold transition-colors ${
                                        current.focalColorId === colour.id ? 'border-purple-500 text-white' : 'border-slate-800 text-slate-400 hover:border-slate-600'
                                    }`}
                                >
                                    <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style={{ background: colour.value ?? 'transparent', border: colour.value ? 'none' : '1px solid currentColor' }} />
                                    {colour.label}
                                </button>
                            ))}
                        </div>
                        <label className="flex items-center gap-2 mt-3 text-sm text-slate-300 cursor-pointer">
                            <input
                                type="checkbox" checked={current.showFocalGuide}
                                onChange={(e) => set({ showFocalGuide: e.target.checked })}
                                className="accent-purple-500 w-4 h-4"
                            />
                            Show the centre guide line in RSVP
                        </label>
                    </div>
                </Section>

                <Section title="Size">
                    <Slider
                        label="Prose size" value={current.proseSizePx} range={LIMITS.proseSizePx}
                        onChange={(v) => set({ proseSizePx: v })} format={(v) => `${v}px`}
                        hint="Used by Natural and Paced reading."
                    />
                    <Slider
                        label="RSVP word size" value={current.rsvpSizePx} range={LIMITS.rsvpSizePx}
                        onChange={(v) => set({ rsvpSizePx: v })} format={(v) => `${v}px`}
                        hint="Large enough to read without moving your eyes at all."
                    />
                    <Slider
                        label="Bionic bold" value={current.bionicStrength} range={LIMITS.bionicStrength} step={0.05}
                        onChange={(v) => set({ bionicStrength: v })} format={(v) => `${Math.round(v * 100)}%`}
                        hint="How much of each word is emboldened when Bionic Reading is on."
                    />
                </Section>

                <Section title="Spacing and layout">
                    <Slider
                        label="Line width" value={current.maxWidthCh} range={LIMITS.maxWidthCh}
                        onChange={(v) => set({ maxWidthCh: v })} format={(v) => `${v}ch`}
                        hint={widthVerdict}
                    />
                    <Slider
                        label="Line height" value={current.lineHeight} range={LIMITS.lineHeight} step={0.05}
                        onChange={(v) => set({ lineHeight: v })} format={(v) => v.toFixed(2)}
                        hint="Too tight and the return sweep lands on the wrong line."
                    />
                    <Slider
                        label="Letter spacing" value={current.letterSpacing} range={LIMITS.letterSpacing} step={0.005}
                        onChange={(v) => set({ letterSpacing: v })} format={(v) => `${v.toFixed(3)}em`}
                    />
                    <Slider
                        label="Word spacing" value={current.wordSpacing} range={LIMITS.wordSpacing} step={0.02}
                        onChange={(v) => set({ wordSpacing: v })} format={(v) => `${v.toFixed(2)}em`}
                        hint="Wider gaps make word boundaries easier to chunk."
                    />
                    <Slider
                        label="Paragraph gap" value={current.paragraphGapEm} range={LIMITS.paragraphGapEm} step={0.1}
                        onChange={(v) => set({ paragraphGapEm: v })} format={(v) => `${v.toFixed(1)}em`}
                    />
                    <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                        <input
                            type="checkbox" checked={current.justify}
                            onChange={(e) => set({ justify: e.target.checked })}
                            className="accent-purple-500 w-4 h-4"
                        />
                        Justify text
                        <span className="text-[11px] text-slate-500">(even edges, but uneven word gaps)</span>
                    </label>
                </Section>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6">
                <label htmlFor="preview-word" className="block text-sm font-bold text-slate-300 mb-2">Try your own word in the RSVP preview</label>
                <input
                    id="preview-word" type="text" value={previewWord}
                    onChange={(e) => setPreviewWord(e.target.value || ' ')}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-purple-500 transition-colors"
                />
            </div>
        </div>
    );
}

export default ReadingEnvironment;
