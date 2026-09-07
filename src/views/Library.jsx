import { useRef, useState } from 'react';
import {
    Activity, BookOpen, Brain, ChevronRight, FileText, Play, Sparkles, Upload, Zap
} from 'lucide-react';
import { dropGuessableQuestions, passageSpec, pushSpec, verifySpec } from '../lib/ai';
import { generateJson } from '../lib/gemini';
import { normalizeQuestions } from '../lib/quiz';
import { splitPassage } from '../lib/protocol';
import { PUSH_DRILL_PASSAGE } from '../lib/drills';
import { isPartiallyRead, nextRecallOn, resumePoint } from '../lib/library';
import { ACCEPT_ATTRIBUTE, SUPPORTED_EXTENSIONS, extractText } from '../lib/importText';
import ManualAiPanel from '../components/ManualAiPanel';

const SOURCE_LABELS = { ai: 'AI', import: 'Imported', youtube: 'Video', builtin: 'Built-in' };

function SectionHeading({ step, icon, title, blurb, badge }) {
    return (
        <div className="flex items-start gap-4 mb-5">
            <div className="shrink-0 w-9 h-9 rounded-xl bg-slate-800 grid place-items-center text-slate-400">
                {icon}
            </div>
            <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Option {step}</span>
                    {badge && (
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 px-2 py-0.5 rounded">
                            {badge}
                        </span>
                    )}
                </div>
                <h2 className="text-xl font-bold text-white mt-0.5">{title}</h2>
                <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">{blurb}</p>
            </div>
        </div>
    );
}

const Card = ({ children, className = '' }) => (
    <div className={`bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-7 ${className}`}>{children}</div>
);

/** What the two AI outputs actually are, since the difference is not obvious. */
function OutputChooser({ value, onChange }) {
    const options = [
        { id: 'passage', label: 'Reading passage', detail: '250 words + 5 questions. One straight read, then a comprehension check.' },
        { id: 'push', label: 'Speed push drill', detail: 'Two sections. Drill the first at escalating speed, then read the unseen second one for score.' }
    ];
    return (
        <div>
            <div className="text-sm font-bold text-slate-400 mb-2">What should it make?</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {options.map(option => (
                    <button
                        key={option.id}
                        onClick={() => onChange(option.id)}
                        className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                            value === option.id
                                ? 'border-purple-500 bg-purple-950/30'
                                : 'border-slate-800 bg-slate-950 hover:border-slate-600'
                        }`}
                    >
                        <div className={`text-sm font-bold ${value === option.id ? 'text-white' : 'text-slate-300'}`}>{option.label}</div>
                        <div className="text-[11px] text-slate-500 mt-1 leading-relaxed">{option.detail}</div>
                    </button>
                ))}
            </div>
        </div>
    );
}

function SavedPassages({ library, onOpenSaved, onDeleteSaved }) {
    if (library.length === 0) {
        return (
            <Card>
                <div className="flex items-start gap-4">
                    <div className="shrink-0 w-9 h-9 rounded-xl bg-slate-800 grid place-items-center text-slate-400"><BookOpen size={18} /></div>
                    <div>
                        <h2 className="text-xl font-bold text-white">Your library</h2>
                        <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">
                            Everything you read gets saved here automatically. You can leave a long text part-way through and pick it up
                            later, and anything with questions comes back after a few days so you can check whether it actually stuck.
                        </p>
                        <p className="text-xs text-slate-600 mt-3">Nothing saved yet — finish a passage and it will appear here.</p>
                    </div>
                </div>
            </Card>
        );
    }

    return (
        <Card>
            <div className="flex items-start justify-between gap-4 mb-5">
                <div className="flex items-start gap-4">
                    <div className="shrink-0 w-9 h-9 rounded-xl bg-slate-800 grid place-items-center text-slate-400"><BookOpen size={18} /></div>
                    <div>
                        <h2 className="text-xl font-bold text-white">Your library</h2>
                        <p className="text-sm text-slate-400 mt-1.5 leading-relaxed max-w-xl">
                            <strong className="text-slate-300">Resume</strong> picks up where you stopped.
                            <strong className="text-slate-300"> Re-test</strong> asks the questions again with the text hidden, to see what
                            stayed with you — a date means one is due.
                        </p>
                    </div>
                </div>
                <span className="text-sm text-slate-500 shrink-0">{library.length}</span>
            </div>

            <div className="space-y-2">
                {library.map(item => {
                    const partial = isPartiallyRead(item);
                    const due = nextRecallOn(item);
                    const scored = item.attempts.filter(a => typeof a.score === 'number');
                    return (
                        <div key={item.id} className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-4 hover:border-slate-700 transition-colors">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h3 className="font-bold text-white truncate">{item.title}</h3>
                                    <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                                        {SOURCE_LABELS[item.source] ?? item.source}
                                    </span>
                                    {item.kind === 'push' && (
                                        <span className="text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded">Push</span>
                                    )}
                                </div>
                                <div className="text-xs text-slate-500 mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                                    <span>{item.words.toLocaleString()} words</span>
                                    {scored.length > 0 && <span>best {Math.max(...scored.map(a => a.score))}%</span>}
                                    {item.attempts.length > 0 && <span>{item.attempts.length} attempt{item.attempts.length === 1 ? '' : 's'}</span>}
                                    {partial && <span className="text-amber-400">{Math.round((resumePoint(item) / item.words) * 100)}% read</span>}
                                    {due && <span className="text-purple-400">re-test {due}</span>}
                                </div>
                            </div>
                            <div className="flex gap-2 shrink-0">
                                <button
                                    onClick={() => onOpenSaved(item.id)}
                                    className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors"
                                >
                                    {partial ? 'Resume' : item.completedAt ? 'Read again' : 'Read'}
                                </button>
                                {item.questions.length > 0 && item.completedAt && (
                                    <button
                                        onClick={() => onOpenSaved(item.id, { recall: true })}
                                        className="border border-purple-800 text-purple-300 hover:bg-purple-900/30 text-sm font-bold px-4 py-2 rounded-lg transition-colors"
                                    >
                                        Re-test
                                    </button>
                                )}
                                <button
                                    onClick={() => onDeleteSaved(item.id)}
                                    className="text-slate-600 hover:text-red-400 px-2 transition-colors"
                                    aria-label={`Delete ${item.title}`}
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </Card>
    );
}

function Library({ library, useApi, verifyQuestions, onStartPassage, onStartPushDrill, onOpenSaved, onDeleteSaved, addNotification }) {
    const [topic, setTopic] = useState('');
    const [difficulty, setDifficulty] = useState(5);
    const [isGenerating, setIsGenerating] = useState(false);
    const [outputKind, setOutputKind] = useState('passage');
    const [customText, setCustomText] = useState('');
    const [importedTitle, setImportedTitle] = useState(null);
    const [importing, setImporting] = useState(false);
    const fileRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);

    // Both AI paths — the API call and the copy/paste exchange — converge on
    // these handlers, so validation can never differ between them.
    const acceptPassage = (data) => {
        if (!data?.text) throw new Error('That reply has no passage text in it.');
        const passageData = { ...data, id: `ai-${Date.now()}` };
        addNotification(normalizeQuestions(passageData.questions).length === 0
            ? 'Quiz came back unusable — running as unscored practice.'
            : 'Passage ready. Loading reader...');
        onStartPassage(passageData, { source: 'ai' });
    };

    const acceptPushDrill = (data) => {
        if (!data?.sectionA || !data?.sectionB) throw new Error('That reply is missing one of the two sections.');
        onStartPushDrill({ ...data, id: `push-${Date.now()}` }, { source: 'ai' });
    };

    const spec = outputKind === 'push'
        ? pushSpec({ topic, difficulty })
        : passageSpec({ topic, difficulty });

    /**
     * Asks the model to answer its own questions with no passage in front of
     * it, and drops any it gets right — those were answerable from general
     * knowledge, so scoring them would inflate comprehension and push the
     * target speed up on a signal that measured nothing.
     */
    const checkQuestions = async (data) => {
        const questions = normalizeQuestions(data.questions);
        if (!verifyQuestions || questions.length === 0) return data;

        try {
            const check = verifySpec({ questions });
            const reply = await generateJson({ prompt: check.prompt, schema: check.schema });
            const { questions: kept, dropped, applied } = dropGuessableQuestions(questions, reply?.answers);

            if (!applied) addNotification('Question check inconclusive — keeping all questions.');
            else if (dropped > 0) addNotification(`Dropped ${dropped} question${dropped === 1 ? '' : 's'} answerable without reading.`);

            return { ...data, questions: kept };
        } catch (error) {
            // A failed check must never block the passage you asked for.
            console.error('Question check failed:', error);
            addNotification('Could not check the questions — using them as written.');
            return data;
        }
    };

    const generate = async () => {
        if (!topic.trim()) return;
        setIsGenerating(true);
        addNotification(outputKind === 'push' ? 'Building speed push drill...' : 'Writing your passage...');
        try {
            const data = await checkQuestions(await generateJson({ prompt: spec.prompt, schema: spec.schema }));
            if (outputKind === 'push') acceptPushDrill(data);
            else acceptPassage(data);
        } catch (error) {
            console.error('AI generation error:', error);
            addNotification(error.message || 'Generation failed.');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCustomStart = () => {
        if (!customText.trim()) return;
        onStartPassage({
            id: `custom-${Date.now()}`,
            title: importedTitle || 'Custom Imported Text',
            text: customText,
            questions: []
        }, { source: 'import' });
    };

    const handleCustomPush = () => {
        const sections = splitPassage(customText);
        if (!sections) {
            addNotification('Need roughly 150+ words to split into two drill sections.');
            return;
        }
        onStartPushDrill({
            id: `push-custom-${Date.now()}`,
            title: importedTitle ? `${importedTitle} (Speed Push)` : 'Custom Speed Push',
            ...sections,
            questions: []
        }, { source: 'import' });
    };

    // One path for both dropping and picking, so every format behaves the same
    // however the file arrives.
    const loadFile = async (file) => {
        if (!file) return;
        setImporting(true);
        try {
            const { title, text } = await extractText(file);
            setCustomText(text);
            setImportedTitle(title);
            addNotification(`Loaded ${text.split(/\s+/).length.toLocaleString()} words from ${file.name}.`);
        } catch (error) {
            console.error('Import error:', error);
            setImportedTitle(null);
            addNotification(error.message || 'Could not read that file.');
        } finally {
            setImporting(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        loadFile(e.dataTransfer.files?.[0]);
    };

    const wordCount = customText.trim() ? customText.trim().split(/\s+/).length : 0;

    return (
        <div className="max-w-4xl mx-auto space-y-6 animate-in slide-in-from-bottom-4 pb-12">
            <div>
                <h1 className="text-3xl font-bold text-white">Library</h1>
                <p className="text-slate-400 mt-2 max-w-2xl leading-relaxed">
                    Where your reading material comes from. Three ways in — a ready-made drill, something written for you by an AI, or
                    your own book, article or PDF. Everything you read is saved below.
                </p>
            </div>

            <details className="group bg-slate-900/60 border border-slate-800 rounded-2xl">
                <summary className="cursor-pointer select-none px-5 py-4 flex items-center gap-2 text-sm font-bold text-slate-300 hover:text-white">
                    <ChevronRight size={15} className="group-open:rotate-90 transition-transform" />
                    How this all fits together
                </summary>
                <div className="px-5 pb-5 pt-1 text-sm text-slate-400 space-y-3 leading-relaxed">
                    <p>
                        A <strong className="text-slate-200">reading passage</strong> is one text you read once and are then quizzed on.
                        Your speed and your score combine into Effective WPM, and that is what moves your target speed up or down.
                    </p>
                    <p>
                        A <strong className="text-slate-200">speed push drill</strong> is the harder, more useful one. You read a section
                        at your normal pace, then again at double, then at triple. Those over-speed passes are not really reading — they
                        exist to reset what fast feels like. Then you read a second section you have never seen, slightly above your target,
                        and that is the read that counts.
                    </p>
                    <p>
                        <strong className="text-slate-200">The AI is optional.</strong> The built-in drill needs nothing. If you have no
                        API key, the generator gives you a prompt to paste into ChatGPT, Claude or Gemini and takes their answer back —
                        same result, twenty seconds more work. Add a key in Settings to skip that.
                    </p>
                    <p>
                        <strong className="text-slate-200">Your own text always works offline.</strong> Drop in an EPUB, PDF, DOCX, HTML or
                        text file, or paste anything. Imported text has no quiz, so it counts as practice: it trains you and keeps your
                        streak, but it cannot move your target speed, because nothing measured your comprehension.
                    </p>
                </div>
            </details>

            {/* Option 1 — works with no setup at all. */}
            <Card className="bg-gradient-to-br from-purple-950/40 to-slate-900 border-purple-800/50">
                <SectionHeading
                    step="1" icon={<Zap size={18} />} badge="No setup"
                    title="Run the built-in drill"
                    blurb="A complete speed push drill on a passage that ships with the app. Nothing to configure, no key, about four minutes. Start here if you are not sure what to do."
                />
                <button
                    onClick={() => onStartPushDrill(PUSH_DRILL_PASSAGE, { source: 'builtin' })}
                    className="w-full sm:w-auto bg-purple-600 hover:bg-purple-500 text-white px-6 py-3.5 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
                >
                    <Play size={17} className="fill-current" /> Start the drill
                </button>
            </Card>

            {/* Option 2 — AI, either via key or copy/paste. */}
            <Card>
                <SectionHeading
                    step="2" icon={<Brain size={18} />}
                    title="Have an AI write something"
                    blurb="Pick any subject and get a passage written at the difficulty you choose, with comprehension questions built to be unanswerable unless you actually read it."
                />

                <div className={`mb-5 text-xs rounded-xl px-4 py-2.5 border flex items-start gap-2 ${
                    useApi
                        ? 'border-emerald-900/60 bg-emerald-950/20 text-emerald-300'
                        : 'border-blue-900/50 bg-blue-950/20 text-blue-300'
                }`}>
                    <Sparkles size={14} className="shrink-0 mt-0.5" />
                    <span>
                        {useApi
                            ? 'Connected to your Gemini key — one click and it writes itself.'
                            : 'No API key set, so this uses copy and paste with any assistant you already have. It works just as well.'}
                    </span>
                </div>

                <div className="space-y-5">
                    <div>
                        <label htmlFor="ai-topic" className="block text-sm font-bold text-slate-400 mb-2">Subject</label>
                        <input
                            id="ai-topic" type="text" value={topic}
                            onChange={(e) => setTopic(e.target.value)}
                            placeholder="Roman aqueducts, deep sea vents, the 2008 crash..."
                            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 transition-colors"
                        />
                        <p className="text-[11px] text-slate-600 mt-1.5">Anything you would genuinely like to read about. Specific beats broad.</p>
                    </div>

                    <div>
                        <label htmlFor="ai-difficulty" className="flex justify-between text-sm font-bold text-slate-400 mb-2">
                            <span>Difficulty</span>
                            <span className="text-purple-400">{difficulty}/10</span>
                        </label>
                        <input
                            id="ai-difficulty" type="range" min="1" max="10" value={difficulty}
                            onChange={(e) => setDifficulty(parseInt(e.target.value))}
                            className="w-full accent-purple-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                        />
                        <p className="text-[11px] text-slate-600 mt-1.5">
                            Low is plain and concrete; high is dense and abstract. Harder text reads slower — that is expected, not a setback.
                        </p>
                    </div>

                    <OutputChooser value={outputKind} onChange={setOutputKind} />

                    {useApi ? (
                        <button
                            onClick={generate} disabled={isGenerating || !topic.trim()}
                            className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors"
                        >
                            {isGenerating ? <Activity className="animate-spin" size={19} /> : <Sparkles size={19} />}
                            {isGenerating ? 'Writing...' : `Generate and start`}
                        </button>
                    ) : (
                        <ManualAiPanel
                            spec={spec}
                            disabled={!topic.trim()}
                            addNotification={addNotification}
                            onResult={outputKind === 'push' ? acceptPushDrill : acceptPassage}
                        />
                    )}
                </div>
            </Card>

            {/* Option 3 — your own material, always offline. */}
            <Card className={isDragging ? 'border-blue-500 bg-blue-950/10' : ''}>
                {/* A drop target, not a control: the picker and textarea below are the
                    keyboard paths, so this adds a shortcut for mouse users. */}
                {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
                <div
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                >
                    <SectionHeading
                        step="3" icon={<FileText size={18} />} badge="Works offline"
                        title="Bring your own reading"
                        blurb="Train on what you actually need to read. Open a file or paste text straight in — no AI involved at any point."
                    />

                    <div className="space-y-4">
                        <div className="flex items-center gap-3 flex-wrap">
                            <button
                                onClick={() => fileRef.current?.click()} disabled={importing}
                                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition-colors"
                            >
                                {importing ? <Activity className="animate-spin" size={16} /> : <Upload size={16} />}
                                {importing ? 'Reading file...' : 'Choose a file'}
                            </button>
                            <span className="text-xs text-slate-500">or drop one anywhere in this box</span>
                            <input
                                ref={fileRef} type="file" accept={ACCEPT_ATTRIBUTE} className="hidden"
                                aria-label="Choose a document to import"
                                onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }}
                            />
                        </div>

                        <p className="text-[11px] text-slate-600">
                            {SUPPORTED_EXTENSIONS.join('   ')} — a book chapter or long article works better than a short one.
                        </p>

                        {importedTitle && (
                            <div className="text-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-300 truncate">
                                <span className="text-slate-500">Loaded:</span> {importedTitle}
                            </div>
                        )}

                        <textarea
                            value={customText}
                            onChange={(e) => { setCustomText(e.target.value); setImportedTitle(null); }}
                            placeholder="...or paste text straight in here."
                            aria-label="Text to read"
                            className="w-full min-h-[9rem] bg-slate-950 border border-slate-700 rounded-xl p-4 text-white resize-y focus:outline-none focus:border-blue-500 transition-colors text-sm"
                        />

                        {wordCount > 0 && (
                            <p className="text-xs text-slate-500">
                                {wordCount.toLocaleString()} words · about {Math.max(1, Math.round(wordCount / 300))} min at 300 WPM
                            </p>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <button
                                onClick={handleCustomStart} disabled={!customText.trim()}
                                className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white font-bold py-3.5 rounded-xl transition-colors"
                            >
                                Read it
                                <span className="block text-[11px] font-normal text-slate-400 mt-0.5">Straight through, no quiz</span>
                            </button>
                            <button
                                onClick={handleCustomPush} disabled={!customText.trim()}
                                className="border border-slate-700 hover:border-purple-500 disabled:opacity-40 text-slate-200 font-bold py-3.5 rounded-xl transition-colors"
                            >
                                Push drill it
                                <span className="block text-[11px] font-normal text-slate-500 mt-0.5">Split in two, 1× / 2× / 3×</span>
                            </button>
                        </div>
                    </div>
                </div>
            </Card>

            <SavedPassages library={library} onOpenSaved={onOpenSaved} onDeleteSaved={onDeleteSaved} />
        </div>
    );
}

export default Library;
