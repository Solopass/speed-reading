import { useEffect } from 'react';
import { RotateCcw, X } from 'lucide-react';
import {
    DEFAULT_READING, FONT_OPTIONS, LIMITS, PACER_STYLES, RSVP_CONTEXT_PLAY_MODES, SCROLL_COLOR_MODES,
    SCROLL_GUIDES, SCROLL_MARKERS, SCROLL_MOTIONS, SCROLL_PALETTES, THEMES
} from '../lib/readingStyle';
import FocalColorPicker from './FocalColorPicker';

function Section({ title, children }) {
    return (
        <section className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{title}</h3>
            {children}
        </section>
    );
}

function Slider({ id, label, value, range, step, onChange, format = (v) => v }) {
    return (
        <div>
            <label htmlFor={id} className="flex justify-between text-sm text-slate-300 mb-1.5">
                <span>{label}</span>
                <span className="font-mono text-purple-400">{format(value)}</span>
            </label>
            <input
                id={id} type="range" min={range[0]} max={range[1]} step={step} value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full accent-purple-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
            />
        </div>
    );
}

function Switch({ label, hint, checked, onChange }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <div className="text-sm text-slate-200">{label}</div>
                {hint && <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{hint}</div>}
            </div>
            <button
                role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
                className={`w-10 h-6 rounded-full relative shrink-0 transition-colors ${checked ? 'bg-purple-600' : 'bg-slate-700'}`}
            >
                <span className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${checked ? 'left-5' : 'left-1'}`} />
            </button>
        </div>
    );
}

function Chips({ options, value, onChange, label }) {
    return (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
            {options.map(o => (
                <button
                    key={o.id} role="radio" aria-checked={value === o.id} title={o.note}
                    onClick={() => onChange(o.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${value === o.id
                        ? 'border-purple-500 bg-purple-500/15 text-purple-300'
                        : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

/** Colour pairs shown as two swatches, mixed into the page's text colour as the reader will see them. */
function Palettes({ value, onChange }) {
    return (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour palette">
            {SCROLL_PALETTES.map(p => (
                <button
                    key={p.id} role="radio" aria-checked={value === p.id} aria-label={p.label} title={p.label}
                    onClick={() => onChange(p.id)}
                    className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border ${value === p.id ? 'border-purple-500 bg-purple-500/15' : 'border-slate-700 hover:border-slate-500'}`}
                >
                    <span className="w-3.5 h-3.5 rounded-full" style={{ background: p.a }} />
                    <span className="w-3.5 h-3.5 rounded-full" style={{ background: p.b }} />
                </button>
            ))}
        </div>
    );
}

/**
 * Everything about how a passage looks and behaves, adjustable mid-read and
 * applied live. Opening it pauses playback, so tuning never costs reading time.
 * Changes are saved to the same settings the Reading Setup page edits.
 */
export default function ReaderSettings({ open, onClose, reading, patchReading, settings, updateSettings, mode }) {
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open, onClose]);

    if (!open) return null;

    const set = (patch) => patchReading(patch);
    const resetLook = () => patchReading({ ...DEFAULT_READING });
    const pct = (v) => `${Math.round(v * 100)}%`;

    // Scroll mode's own settings; shown first while scrolling.
    const scrollSection = (
        <Section title="Scroll">
            <div>
                <div className="text-sm text-slate-300 mb-1.5">Text colour</div>
                <Chips label="Scroll text colour" options={SCROLL_COLOR_MODES} value={reading.scrollColor} onChange={(id) => set({ scrollColor: id })} />
                <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">
                    {SCROLL_COLOR_MODES.find(m => m.id === reading.scrollColor)?.note}
                </p>
            </div>
            {reading.scrollColor !== 'none' && (
                <>
                    <Palettes value={reading.scrollPalette} onChange={(id) => set({ scrollPalette: id })} />
                    <Slider id="rs-scroll-strength" label="Colour strength" value={reading.scrollColorStrength} range={LIMITS.scrollColorStrength} step={0.05} onChange={(v) => set({ scrollColorStrength: v })} format={pct} />
                </>
            )}
            <Switch label="Fade text already read" checked={reading.dimRead} onChange={(v) => set({ dimRead: v })} />
            {reading.dimRead && (
                <Slider id="rs-scroll-read-opacity" label="Read text stays" value={reading.readOpacity} range={LIMITS.readOpacity} step={0.05} onChange={(v) => set({ readOpacity: v })} format={pct} />
            )}
            <Switch label="Fade small words" hint={'"the", "of", "and" and the like go fainter, so your eye lands on the words that carry meaning.'} checked={reading.scrollFadeFunctionWords} onChange={(v) => set({ scrollFadeFunctionWords: v })} />
            <div>
                <div className="text-sm text-slate-300 mb-1.5">Highlight at the reading line</div>
                <Chips label="Scroll highlight" options={SCROLL_MARKERS} value={reading.scrollMarker} onChange={(id) => set({ scrollMarker: id })} />
            </div>
            <Switch label="Smart pacing" hint="Slows at punctuation and long words, speeds through short ones; the average speed stays what you set." checked={reading.scrollPacing} onChange={(v) => set({ scrollPacing: v })} />
            {reading.scrollPacing && (
                <Switch label="More time for rare words" hint="Smart pacing also slows for unfamiliar words and names." checked={reading.rarityPacing} onChange={(v) => set({ rarityPacing: v })} />
            )}
            <div>
                <div className="text-sm text-slate-300 mb-1.5">Motion</div>
                <Chips label="Scroll motion" options={SCROLL_MOTIONS} value={reading.scrollMotion} onChange={(id) => set({ scrollMotion: id })} />
            </div>
            <div>
                <div className="text-sm text-slate-300 mb-1.5">Reading guide</div>
                <Chips label="Scroll reading guide" options={SCROLL_GUIDES} value={reading.scrollGuide} onChange={(id) => set({ scrollGuide: id })} />
            </div>
            {reading.scrollGuide === 'band' && (
                <Slider id="rs-scroll-band" label="Band height" value={reading.scrollBandLines} range={LIMITS.scrollBandLines} step={1} onChange={(v) => set({ scrollBandLines: v })} format={(v) => `${v} line${v > 1 ? 's' : ''}`} />
            )}
            <Slider id="rs-scroll-spot" label="Spotlight" value={reading.scrollSpotlight} range={LIMITS.scrollSpotlight} step={0.05} onChange={(v) => set({ scrollSpotlight: v })} format={(v) => (v === 0 ? 'Off' : pct(v))} />
            <div className="space-y-1">
                <Slider id="rs-scroll-focal" label="Reading line position" value={reading.scrollFocalPct} range={LIMITS.scrollFocalPct} step={2} onChange={(v) => set({ scrollFocalPct: v })} format={(v) => `${v}% down`} />
                {reading.scrollFocalPct !== DEFAULT_READING.scrollFocalPct && (
                    <button
                        type="button"
                        onClick={() => set({ scrollFocalPct: DEFAULT_READING.scrollFocalPct })}
                        className="text-[11px] text-purple-400 hover:text-purple-300 font-medium"
                    >
                        Reset to {DEFAULT_READING.scrollFocalPct}%
                    </button>
                )}
            </div>
            <Slider id="rs-scroll-height" label="Window height" value={reading.scrollHeightVh} range={LIMITS.scrollHeightVh} step={5} onChange={(v) => set({ scrollHeightVh: v })} format={(v) => `${v}% of screen`} />
            <Slider id="rs-scroll-fade" label="Edge fade" value={reading.scrollEdgeFade} range={LIMITS.scrollEdgeFade} step={2} onChange={(v) => set({ scrollEdgeFade: v })} format={(v) => (v === 0 ? 'Off' : `${v}%`)} />
            <Slider id="rs-scroll-tunnel" label="Focus tunnel" value={reading.scrollTunnel} range={LIMITS.scrollTunnel} step={5} onChange={(v) => set({ scrollTunnel: v })} format={(v) => (v === 0 ? 'Off' : `${v}%`)} />
        </Section>
    );

    return (
        <div className="fixed inset-0 z-[55] flex justify-end">
            <button aria-label="Close reading settings" className="absolute inset-0 bg-black/40" onClick={onClose} />
            <aside
                className="relative w-full max-w-sm h-full bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col animate-in slide-in-from-right-8"
                role="dialog" aria-label="Reading settings"
            >
                <header className="flex items-center justify-between px-5 h-14 border-b border-slate-800 shrink-0">
                    <span className="font-bold text-white">Reading settings</span>
                    <button onClick={onClose} aria-label="Close" className="p-2 -mr-2 text-slate-400 hover:text-white"><X size={18} /></button>
                </header>

                <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7">
                    {mode === 'scroll' && scrollSection}

                    <Section title="Page">
                        <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Page colours">
                            {THEMES.map(t => (
                                <button
                                    key={t.id} role="radio" aria-checked={reading.themeId === t.id} aria-label={t.label} title={t.label}
                                    onClick={() => set({ themeId: t.id })}
                                    className={`h-10 rounded-lg border-2 text-xs font-bold ${reading.themeId === t.id ? 'border-purple-500' : 'border-transparent'}`}
                                    style={{ background: t.bg, color: t.fg }}
                                >
                                    Aa
                                </button>
                            ))}
                        </div>
                        <div>
                            <label htmlFor="rs-font" className="text-sm text-slate-300 block mb-1.5">Font</label>
                            <select
                                id="rs-font" value={reading.fontId} onChange={(e) => set({ fontId: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                            >
                                {FONT_OPTIONS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                            </select>
                        </div>
                        <Slider id="rs-size" label="Text size" value={reading.proseSizePx} range={LIMITS.proseSizePx} step={1} onChange={(v) => set({ proseSizePx: v })} format={(v) => `${v}px`} />
                        <Slider id="rs-lh" label="Line spacing" value={reading.lineHeight} range={LIMITS.lineHeight} step={0.05} onChange={(v) => set({ lineHeight: v })} format={(v) => v.toFixed(2)} />
                        <Slider id="rs-width" label="Line width" value={reading.maxWidthCh} range={LIMITS.maxWidthCh} step={2} onChange={(v) => set({ maxWidthCh: v })} format={(v) => `${v} ch`} />
                        <Slider id="rs-ls" label="Letter spacing" value={reading.letterSpacing} range={LIMITS.letterSpacing} step={0.01} onChange={(v) => set({ letterSpacing: v })} format={(v) => `${v.toFixed(2)}em`} />
                        <Switch label="Justify text" checked={reading.justify} onChange={(v) => set({ justify: v })} />
                    </Section>

                    <Section title="Flash (RSVP)">
                        <Slider id="rs-rsvp" label="Word size" value={reading.rsvpSizePx} range={LIMITS.rsvpSizePx} step={2} onChange={(v) => set({ rsvpSizePx: v })} format={(v) => `${v}px`} />
                        <Slider id="rs-rsvp-weight" label="Flash weight" value={reading.rsvpWeight} range={LIMITS.rsvpWeight} step={100} onChange={(v) => set({ rsvpWeight: v })} format={(v) => ({ 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Heavy' }[v] ?? v)} />
                        <Slider id="rs-chunk" label={settings.chunkSize > 1 && settings.smartChunks !== false ? 'Words per flash (up to)' : 'Words per flash'} value={settings.chunkSize} range={[1, 5]} step={1} onChange={(v) => updateSettings({ chunkSize: v })} />
                        {settings.chunkSize > 1 && (
                            <Switch
                                label="Group by phrase"
                                hint="Flashes follow phrases and never run across a sentence end; off gives fixed slices."
                                checked={settings.smartChunks !== false}
                                onChange={(v) => updateSettings({ smartChunks: v })}
                            />
                        )}
                        <div>
                            <div className="text-sm text-slate-300 mb-1.5">Focal letter</div>
                            <FocalColorPicker reading={reading} onChange={set} />
                        </div>
                        <Switch label="Centre guide" hint="A faint line through the focal letter." checked={reading.showFocalGuide} onChange={(v) => set({ showFocalGuide: v })} />
                        <Switch label="Show surrounding words" hint="Before and after text above and below the flash, so you keep your place." checked={reading.rsvpContext} onChange={(v) => set({ rsvpContext: v })} />
                        {reading.rsvpContext && (
                            <div>
                                <div className="text-sm text-slate-300 mb-1.5">Context while playing</div>
                                <Chips label="Context while playing" options={RSVP_CONTEXT_PLAY_MODES} value={reading.rsvpContextPlay} onChange={(id) => set({ rsvpContextPlay: id })} />
                            </div>
                        )}
                        {settings.chunkSize === 1 && (
                            <Switch
                                label="Merge tiny glue words"
                                hint='Pairs short words ("in the", "of a") in 1-word mode to cut flicker at 1,000+ WPM.'
                                checked={reading.rsvpMergeShortWords}
                                onChange={(v) => set({ rsvpMergeShortWords: v })}
                            />
                        )}
                        <Switch label="Pause at punctuation" hint="A beat after commas and full stops." checked={settings.punctuationPacing} onChange={(v) => updateSettings({ punctuationPacing: v })} />
                        <Switch label="More time for rare words" hint="Unfamiliar words and names stay up a little longer, everyday words a little less; your average speed is unchanged." checked={reading.rarityPacing} onChange={(v) => set({ rarityPacing: v })} />
                        <Switch label="Preview the next group" hint="Shows what comes next, faintly, under the flash." checked={reading.rsvpPreviewNext} onChange={(v) => set({ rsvpPreviewNext: v })} />
                    </Section>

                    {mode !== 'scroll' && scrollSection}

                    <Section title="Pacer & Prose">
                        <Chips label="Pacer style" options={PACER_STYLES} value={reading.pacerStyle} onChange={(id) => set({ pacerStyle: id })} />
                        {/* In Scroll mode these sit in the Scroll section above. */}
                        {mode !== 'scroll' && (
                            <>
                                <Switch label="Fade words already passed" checked={reading.dimRead} onChange={(v) => set({ dimRead: v })} />
                                {reading.dimRead && (
                                    <Slider id="rs-read-opacity" label="Read text stays" value={reading.readOpacity} range={LIMITS.readOpacity} step={0.05} onChange={(v) => set({ readOpacity: v })} format={pct} />
                                )}
                            </>
                        )}
                        <Switch label="Bionic bold" hint="Bolds the start of each word." checked={settings.bionicReading} onChange={(v) => updateSettings({ bionicReading: v })} />
                        {settings.bionicReading && (
                            <Slider id="rs-bionic" label="Bold amount" value={reading.bionicStrength} range={LIMITS.bionicStrength} step={0.05} onChange={(v) => set({ bionicStrength: v })} format={(v) => `${Math.round(v * 100)}%`} />
                        )}
                    </Section>

                    <Section title="Session">
                        <Switch label="3-2-1 countdown" hint="A moment to settle your eyes before it starts." checked={reading.countdown} onChange={(v) => set({ countdown: v })} />
                        <Switch label="Warm-up ramp" hint="Starts at 70% of your speed and reaches full speed a quarter of the way in." checked={reading.speedRamp} onChange={(v) => set({ speedRamp: v })} />
                        <Slider id="rs-accel" label="Speed builder" value={reading.accelWpmPerMin} range={LIMITS.accelWpmPerMin} step={5} onChange={(v) => set({ accelWpmPerMin: v })} format={(v) => (v === 0 ? 'Off' : `+${v} WPM / min`)} />
                        {reading.accelWpmPerMin > 0 && (
                            <>
                                <Slider id="rs-accel-cap" label="Builds up to" value={reading.accelCapPct} range={LIMITS.accelCapPct} step={5} onChange={(v) => set({ accelCapPct: v })} format={(v) => `${v}% of start`} />
                                <p className="text-[11px] text-slate-500 -mt-1 leading-snug">Speeds up a little every minute you read, stretching your pace without a jump. Your measured speed is what gets recorded.</p>
                            </>
                        )}
                        <Slider id="rs-hold-slow" label="Hold Shift to slow to" value={reading.holdSlowPct} range={LIMITS.holdSlowPct} step={5} onChange={(v) => set({ holdSlowPct: v })} format={(v) => `${v}% speed`} />
                        <Switch label="Separate speed per mode" hint="Paced and Scroll remember their own speed, relative to your RSVP speed." checked={settings.separateModeSpeeds !== false} onChange={(v) => updateSettings({ separateModeSpeeds: v })} />
                        <Slider id="rs-rewind" label="Rewind on resume" value={reading.rewindWords} range={LIMITS.rewindWords} step={1} onChange={(v) => set({ rewindWords: v })} format={(v) => (v === 0 ? 'Off' : `${v} word${v > 1 ? 's' : ''}`)} />
                        <Switch label="Hide controls while reading" hint="Move the mouse over the top bar to bring them back." checked={reading.zen} onChange={(v) => set({ zen: v })} />
                        {mode === 'rsvp' && (
                            <Switch label="Speak each flash" hint="Text to speech in step with RSVP. Best below about 400 WPM." checked={settings.audioSyncEnabled} onChange={(v) => updateSettings({ audioSyncEnabled: v })} />
                        )}
                    </Section>
                </div>

                <footer className="px-5 py-3 border-t border-slate-800 flex items-center justify-between shrink-0">
                    <button onClick={resetLook} className="text-xs font-bold text-slate-400 hover:text-white flex items-center gap-1.5">
                        <RotateCcw size={13} /> Reset look to defaults
                    </button>
                    <span className="text-[11px] text-slate-600">Saved automatically</span>
                </footer>
            </aside>
        </div>
    );
}
