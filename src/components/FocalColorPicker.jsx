import { Check, Plus, X } from 'lucide-react';
import { DEFAULT_READING, FOCAL_COLORS, FOCAL_SPANS, normalizeHexColor } from '../lib/readingStyle';

/**
 * Preset focal-letter colours, custom colour chooser, saved custom swatches,
 * and highlight-span options. Shared between Reading Settings and Reading Setup.
 */
export default function FocalColorPicker({ reading, onChange }) {
    const focalColorId = reading?.focalColorId ?? DEFAULT_READING.focalColorId;
    const focalSpan = reading?.focalSpan ?? DEFAULT_READING.focalSpan;
    const customColor = normalizeHexColor(reading?.focalCustomColor, DEFAULT_READING.focalCustomColor);
    const saved = Array.isArray(reading?.savedFocalColors) ? reading.savedFocalColors : [];
    const alreadySaved = saved.includes(customColor);
    const isCustomActive = focalColorId === 'custom';

    const pickCustom = (hex) => {
        const clean = normalizeHexColor(hex, customColor);
        onChange({ focalColorId: 'custom', focalCustomColor: clean });
    };

    const saveCurrentCustom = () => {
        if (alreadySaved) {
            onChange({ focalColorId: 'custom', focalCustomColor: customColor });
            return;
        }
        const next = [customColor, ...saved].slice(0, 12);
        onChange({ focalColorId: 'custom', focalCustomColor: customColor, savedFocalColors: next });
    };

    const removeSaved = (hex) => {
        const next = saved.filter(c => c !== hex);
        onChange({ savedFocalColors: next });
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Focal letter colour">
                {FOCAL_COLORS.map(c => {
                    const active = focalColorId === c.id;
                    return (
                        <button
                            key={c.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => onChange({ focalColorId: c.id })}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                                active
                                    ? 'border-purple-500 bg-purple-500/15 text-white'
                                    : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                            }`}
                        >
                            <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{
                                    background: c.value ?? 'transparent',
                                    border: c.value ? 'none' : '1px solid currentColor'
                                }}
                            />
                            {c.label}
                        </button>
                    );
                })}
            </div>

            <div className="flex items-center gap-2 flex-wrap pt-1">
                <label className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer transition-colors ${
                    isCustomActive ? 'border-purple-500 bg-purple-500/15 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500'
                }`}>
                    <input
                        type="color"
                        value={customColor}
                        aria-label="Choose custom focal colour"
                        onChange={(e) => pickCustom(e.target.value)}
                        className="w-5 h-5 rounded cursor-pointer bg-transparent border-0 p-0"
                    />
                    <span>Custom</span>
                    <span className="font-mono text-[11px] text-slate-400">{customColor}</span>
                </label>

                <button
                    type="button"
                    onClick={saveCurrentCustom}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 hover:border-purple-500 text-xs font-bold text-slate-300 hover:text-white transition-colors"
                    title={alreadySaved ? 'Custom colour already saved' : 'Save this custom colour'}
                >
                    {alreadySaved ? <Check size={12} className="text-emerald-400" /> : <Plus size={12} />}
                    {alreadySaved ? 'Saved' : 'Save colour'}
                </button>
            </div>

            {saved.length > 0 && (
                <div className="space-y-1">
                    <div className="text-[11px] text-slate-500">Saved colours</div>
                    <div className="flex flex-wrap gap-1.5">
                        {saved.map(hex => {
                            const active = isCustomActive && customColor === hex;
                            return (
                                <div
                                    key={hex}
                                    className={`inline-flex items-center rounded-lg border overflow-hidden transition-colors ${
                                        active ? 'border-purple-500 bg-purple-500/15' : 'border-slate-700 bg-slate-900/60 hover:border-slate-500'
                                    }`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => pickCustom(hex)}
                                        aria-label={`Use saved focal colour ${hex}`}
                                        className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-mono text-slate-200"
                                    >
                                        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: hex }} />
                                        {hex}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => removeSaved(hex)}
                                        aria-label={`Remove saved colour ${hex}`}
                                        className="px-1.5 py-1 text-slate-500 hover:text-rose-400 transition-colors"
                                        title="Remove saved colour"
                                    >
                                        <X size={11} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="space-y-1.5 pt-1">
                <div className="text-[11px] text-slate-400 font-medium">Highlight span</div>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Focal highlight span">
                    {FOCAL_SPANS.map(s => (
                        <button
                            key={s.id}
                            type="button"
                            role="radio"
                            aria-checked={focalSpan === s.id}
                            title={s.note}
                            onClick={() => onChange({ focalSpan: s.id })}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                                focalSpan === s.id
                                    ? 'border-purple-500 bg-purple-500/15 text-purple-200'
                                    : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                            }`}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
