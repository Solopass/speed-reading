import { useRef, useState } from 'react';
import { Download, Minus, Plus, Upload } from 'lucide-react';
import { WPM_MAX, WPM_MIN, clampWpm } from '../lib/stats';
import { PUSH_PHASES, intensityLabel, phaseMultiplier } from '../lib/protocol';
import { describeBackup } from '../lib/backup';
import Toggle from '../components/Toggle';

const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

function DataPanel({ onExport, onImport }) {
    const fileRef = useRef(null);
    const [pending, setPending] = useState(null);
    const [error, setError] = useState(null);

    // Read and summarise first. Importing replaces the whole profile, so the
    // user gets to see what they are swapping in before anything is lost.
    const inspect = (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const parsed = JSON.parse(event.target.result);
                setPending({ parsed, summary: describeBackup(parsed) });
                setError(null);
            } catch (err) {
                setPending(null);
                setError(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message);
            }
        };
        reader.onerror = () => setError('Could not read that file.');
        reader.readAsText(file);
    };

    return (
        <div className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl space-y-4">
            <h2 className="text-xl font-bold text-white mb-1">Your Data</h2>
            <p className="text-sm text-slate-400 mb-4">
                Everything — baseline, sessions, saved passages, plans and drill history — lives in this browser only. Clearing site data or
                switching browsers loses it. Export regularly.
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
                <button
                    onClick={onExport}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                    <Download size={18} /> Export backup
                </button>
                <button
                    onClick={() => fileRef.current?.click()}
                    className="flex-1 border border-slate-700 hover:border-purple-500 text-slate-200 font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                    <Upload size={18} /> Import backup
                </button>
                <input
                    ref={fileRef} type="file" accept="application/json,.json" className="hidden"
                    aria-label="Choose a backup file"
                    onChange={(e) => { inspect(e.target.files?.[0]); e.target.value = ''; }}
                />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            {pending && (
                <div className="border border-amber-800/60 bg-amber-950/20 rounded-2xl p-4 space-y-3">
                    <p className="text-sm font-bold text-amber-300">This will replace everything currently stored.</p>
                    <ul className="text-xs text-slate-300 space-y-1">
                        <li>Exported {pending.summary.exportedAt}</li>
                        <li>
                            {plural(pending.summary.sessions, 'session')} · {plural(pending.summary.passages, 'saved passage')} · {plural(pending.summary.drills, 'drill run')} · {plural(pending.summary.plans, 'plan')}
                        </li>
                        <li>
                            Target {pending.summary.targetWpm} WPM
                            {pending.summary.baselineWpm ? ` · baseline ${pending.summary.baselineWpm} WPM` : ' · no baseline set'}
                        </li>
                    </ul>
                    <div className="flex gap-2">
                        <button
                            onClick={() => { onImport(pending.parsed); setPending(null); }}
                            className="bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors"
                        >
                            Replace my data
                        </button>
                        <button
                            onClick={() => setPending(null)}
                            className="text-slate-400 hover:text-white text-sm font-medium px-3"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Who decides how fast you read: the app, or you.
 *
 * Both are legitimate. Adaptation is disciplined but slow and can feel like it
 * is holding you back on an easy text; setting it yourself is faster to move
 * but relies on your own judgement of when you are ready.
 */
function TargetSpeedPanel({ settings, updateSettings, adaptiveTargetWpm, pushIntensity }) {
    const manual = !settings.autoAdaptive;

    // Switching to manual starts from wherever adaptation had got to, so the
    // speed never jumps just because you took the wheel.
    const chooseManual = () => updateSettings({ autoAdaptive: false, baseWpm: clampWpm(adaptiveTargetWpm) });
    const nudge = (delta) => updateSettings({ baseWpm: clampWpm(settings.baseWpm + delta) });

    return (
        <div className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl">
            <h2 className="text-xl font-bold text-white mb-1">Target speed</h2>
            <p className="text-sm text-slate-400 mb-5">
                The speed the reader opens at. Either the app moves it for you based on your quiz scores, or you set it and change it
                when you feel ready.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
                <button
                    onClick={() => updateSettings({ autoAdaptive: true })}
                    className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                        !manual ? 'border-purple-500 bg-purple-950/30' : 'border-slate-800 bg-slate-950 hover:border-slate-600'
                    }`}
                >
                    <div className={`text-sm font-bold ${!manual ? 'text-white' : 'text-slate-300'}`}>Let the app set it</div>
                    <div className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        Moves after every quizzed session, based on how much you retained. Drill difficulty follows the same evidence.
                    </div>
                </button>
                <button
                    onClick={chooseManual}
                    className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                        manual ? 'border-purple-500 bg-purple-950/30' : 'border-slate-800 bg-slate-950 hover:border-slate-600'
                    }`}
                >
                    <div className={`text-sm font-bold ${manual ? 'text-white' : 'text-slate-300'}`}>I&rsquo;ll set it myself</div>
                    <div className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        Locked where you put it. Raise it whenever you feel ready. Drills stay at their standard difficulty too.
                    </div>
                </button>
            </div>

            {manual ? (
                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5">
                    <div className="flex items-center justify-center gap-4 mb-4">
                        <button
                            onClick={() => nudge(-25)} disabled={settings.baseWpm <= WPM_MIN}
                            className="w-11 h-11 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white grid place-items-center transition-colors"
                            aria-label="Decrease target speed by 25"
                        >
                            <Minus size={18} />
                        </button>
                        <div className="text-center min-w-[7rem]">
                            <div className="text-4xl font-black text-white tabular-nums">{settings.baseWpm}</div>
                            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mt-0.5">WPM</div>
                        </div>
                        <button
                            onClick={() => nudge(25)} disabled={settings.baseWpm >= WPM_MAX}
                            className="w-11 h-11 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white grid place-items-center transition-colors"
                            aria-label="Increase target speed by 25"
                        >
                            <Plus size={18} />
                        </button>
                    </div>

                    <input
                        type="range" min={WPM_MIN} max={WPM_MAX} step="25"
                        value={settings.baseWpm}
                        onChange={(e) => updateSettings({ baseWpm: parseInt(e.target.value) })}
                        aria-label="Target speed"
                        className="w-full accent-purple-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-[11px] text-slate-600 mt-1 font-mono">
                        <span>{WPM_MIN}</span>
                        <span>{WPM_MAX}</span>
                    </div>

                    <p className="text-xs text-slate-500 mt-4 leading-relaxed">
                        Your scores are still recorded, and Effective WPM still tells you whether a speed is actually working — it just
                        will not change this number. A good habit: when you score 5/5 twice running, add 25.
                    </p>
                </div>
            ) : (
                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5">
                    <div className="flex items-baseline gap-3 mb-3">
                        <span className="text-3xl font-black text-white tabular-nums">{adaptiveTargetWpm}</span>
                        <span className="text-sm text-slate-400">WPM right now</span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                        After each quizzed session: 5 out of 5 climbs 5%, 4 out of 5 holds steady, 3 out of 5 eases back 3%, and worse
                        than that backs off 8%. Practice without a quiz never moves it, because nothing measured your comprehension.
                    </p>
                    <p className="text-xs text-slate-500 leading-relaxed mt-3 pt-3 border-t border-slate-800">
                        Push overload is <strong className="text-slate-300">{intensityLabel(pushIntensity)}</strong>, so the drill&rsquo;s
                        over-speed passes run at{' '}
                        <span className="font-mono text-slate-300">
                            {phaseMultiplier(PUSH_PHASES[1], pushIntensity)}×
                        </span>{' '}and{' '}
                        <span className="font-mono text-slate-300">
                            {phaseMultiplier(PUSH_PHASES[2], pushIntensity)}×
                        </span>{' '}your target rather than a fixed 2× and 3×. It moves on the same scores. The measured read stays
                        at 1.3× either way, so results remain comparable.
                    </p>
                </div>
            )}
        </div>
    );
}

function SettingsPanel({ settings, updateSettings, apiKeyPresent, hasBaseline, adaptiveTargetWpm, pushIntensity, onExport, onImport, onRecalibrate }) {
    return (
        <div className="max-w-2xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 pb-12">
            <div>
                <h1 className="text-3xl font-bold text-white">System Settings</h1>
                <p className="text-slate-400 mt-2">Configure Phase 4 Neuroscience Modules and Engine Params.</p>
            </div>

            <div className="space-y-6">
                <div className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl space-y-4">
                    <h2 className="text-xl font-bold text-white mb-4">Phase 4 Modules</h2>
                    <Toggle
                        label="Bionic Reading Mode" desc="Bolds the first half of words in Natural Reading to guide eye fixation."
                        checked={settings.bionicReading} onChange={(v) => updateSettings({bionicReading: v})}
                    />
                    <Toggle
                        label="Punctuation Pacing" desc="Injects 150-300ms micro-pauses at commas and periods in RSVP mode."
                        checked={settings.punctuationPacing} onChange={(v) => updateSettings({punctuationPacing: v})}
                    />
                    <Toggle
                        label="Audio Sync (TTS)" desc="Speaks each chunk as it flashes. Most useful below ~400 WPM — past that the speech truncates to stay in step."
                        checked={settings.audioSyncEnabled} onChange={(v) => updateSettings({audioSyncEnabled: v})}
                    />
                    <Toggle
                        label="RPG Leveling Display" desc="Replaces the streak counter with a Neuro-Tier based on eWPM."
                        checked={settings.rpgLeveling} onChange={(v) => updateSettings({rpgLeveling: v})}
                    />
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl">
                    <h2 className="text-xl font-bold text-white mb-1">Baseline</h2>
                    <p className="text-sm text-slate-400 mb-4">
                        {hasBaseline
                            ? 'Retake it if the first run was rushed or interrupted — every target and every "since baseline" number is measured from it, so a bad one skews everything. Retaking replaces the old figure; your session history is kept.'
                            : 'Not set yet. Take the baseline test from the dashboard so your target speed starts from a real measurement.'}
                    </p>
                    <button
                        onClick={onRecalibrate}
                        className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-5 py-3 rounded-xl transition-colors"
                    >
                        {hasBaseline ? 'Retake baseline test' : 'Take baseline test'}
                    </button>
                </div>

                <DataPanel onExport={onExport} onImport={onImport} />

                <div className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl space-y-4">
                    <h2 className="text-xl font-bold text-white mb-4">AI Features</h2>
                    <Toggle
                        label="Call the Gemini API directly"
                        desc="Off, or with no key configured, the AI features stay available through a copy/paste panel: it hands you the prompt for ChatGPT, Claude, or anything else you have open, and takes the reply back as pasted JSON."
                        checked={settings.useGeminiApi} onChange={(v) => updateSettings({ useGeminiApi: v })}
                    />
                    <Toggle
                        label="Check questions before using them"
                        desc="After generating, asks the model to answer its own questions with no passage in front of it, and drops any it gets right. Those were answerable from general knowledge, and scoring them would inflate your comprehension. Costs one extra call; needs an API key."
                        checked={settings.verifyQuestions} onChange={(v) => updateSettings({ verifyQuestions: v })}
                    />

                    <div className={`text-xs px-4 py-3 rounded-xl border ${apiKeyPresent ? 'border-emerald-900/60 bg-emerald-950/20 text-emerald-300' : 'border-slate-800 bg-slate-950 text-slate-400'}`}>
                        {apiKeyPresent
                            ? (settings.useGeminiApi
                                ? 'API key detected — passages, drills, and diagnostics generate directly.'
                                : 'API key detected but switched off. Using copy/paste instead.')
                            : 'No API key configured, so copy/paste is in use regardless of this switch. Add VITE_GEMINI_API_KEY to a .env file to enable direct calls.'}
                    </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl">
                    <h2 className="text-xl font-bold text-white mb-4">Goal</h2>
                    <label className="flex justify-between font-bold text-white mb-2">
                        <span>Target to work toward</span>
                        <span className="text-amber-400">{settings.goalWpm} WPM</span>
                    </label>
                    <input
                        type="range" min="400" max={WPM_MAX} step="50"
                        value={settings.goalWpm} onChange={(e) => updateSettings({ goalWpm: parseInt(e.target.value) })}
                        className="w-full accent-amber-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                    />
                    <p className="text-xs text-slate-500 mt-2">
                        Sets the “Road to” tracker on your dashboard. Full comprehension reading tops out around 500–600 WPM for
                        most people; past roughly 700 you are skimming, and your Effective WPM will show you exactly where that
                        line falls for you rather than guessing.
                    </p>
                </div>

                <TargetSpeedPanel
                    settings={settings} updateSettings={updateSettings}
                    adaptiveTargetWpm={adaptiveTargetWpm} pushIntensity={pushIntensity}
                />

                <div className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl">
                    <h2 className="text-xl font-bold text-white mb-4">RSVP</h2>
                    <label htmlFor="chunk-size" className="flex justify-between font-bold text-white mb-2">
                        <span>Words per flash</span>
                        <span className="text-purple-400">{settings.chunkSize}</span>
                    </label>
                    <input
                        id="chunk-size" type="range" min="1" max="5" step="1"
                        value={settings.chunkSize} onChange={(e) => updateSettings({ chunkSize: parseInt(e.target.value) })}
                        className="w-full accent-purple-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                    />
                    <p className="text-xs text-slate-500 mt-2">
                        More than one word per flash turns off the red focal letter, since there is no single centre to mark.
                    </p>
                </div>

            </div>
        </div>
    );
}

export default SettingsPanel;
