import { useRef, useState } from 'react';
import {
    ArrowDown, ArrowUp, Check, Copy, Download, Map, Play, Plus, RotateCcw, Trash2, Upload
} from 'lucide-react';
import {
    STARTER_PLANS, STEP_KINDS, STEP_KIND_IDS, createPlan, createStep,
    isStepDone, nextStep, parsePlan, planFilename, planProgress, resetProgress, toMarkdown
} from '../lib/plans';

const Card = ({ children, className = '' }) => (
    <div className={`bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-7 ${className}`}>{children}</div>
);

function StepRow({ step, index, done, editing, onToggle, onRun, onChange, onMove, onDelete, isNext }) {
    const kind = STEP_KINDS[step.kind];

    if (editing) {
        return (
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-600 w-5">{index + 1}</span>
                    <select
                        value={step.kind}
                        onChange={(e) => onChange({ ...step, kind: e.target.value })}
                        aria-label={`Step ${index + 1} type`}
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                    >
                        {STEP_KIND_IDS.map(id => (
                            <option key={id} value={id}>{STEP_KINDS[id].label}</option>
                        ))}
                    </select>
                    <button onClick={() => onMove(-1)} aria-label={`Move step ${index + 1} up`} className="p-2 text-slate-500 hover:text-white transition-colors"><ArrowUp size={15} /></button>
                    <button onClick={() => onMove(1)} aria-label={`Move step ${index + 1} down`} className="p-2 text-slate-500 hover:text-white transition-colors"><ArrowDown size={15} /></button>
                    <button onClick={onDelete} aria-label={`Delete step ${index + 1}`} className="p-2 text-slate-600 hover:text-red-400 transition-colors"><Trash2 size={15} /></button>
                </div>
                <input
                    type="text" value={step.note}
                    onChange={(e) => onChange({ ...step, note: e.target.value })}
                    placeholder="What to focus on, or why this step is here..."
                    aria-label={`Step ${index + 1} note`}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                />
            </div>
        );
    }

    return (
        <div className={`border rounded-2xl p-4 flex items-start gap-3 transition-colors ${
            done ? 'border-slate-800/60 bg-slate-950/50' : isNext ? 'border-purple-700/60 bg-purple-950/20' : 'border-slate-800 bg-slate-950'
        }`}>
            <button
                onClick={onToggle}
                aria-label={done ? `Mark step ${index + 1} not done` : `Mark step ${index + 1} done`}
                className={`shrink-0 w-6 h-6 rounded-full border grid place-items-center mt-0.5 transition-colors ${
                    done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-600 hover:border-emerald-500'
                }`}
            >
                {done && <Check size={13} strokeWidth={3} />}
            </button>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-bold ${done ? 'text-slate-500 line-through' : 'text-white'}`}>{kind.label}</span>
                    {isNext && !done && (
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded">Next</span>
                    )}
                </div>
                <p className={`text-xs mt-1 leading-relaxed ${done ? 'text-slate-600' : 'text-slate-400'}`}>
                    {step.note || kind.blurb}
                </p>
            </div>

            {kind.view && !done && (
                <button
                    onClick={onRun}
                    className="shrink-0 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5"
                >
                    <Play size={12} className="fill-current" /> Go
                </button>
            )}
        </div>
    );
}

function PlanDetail({ plan, onChange, onDelete, onExport, onCopy, onRun, onBack }) {
    const [editing, setEditing] = useState(false);
    const progress = planProgress(plan);
    const upNext = nextStep(plan);

    const updateStep = (index, step) => {
        const steps = [...plan.steps];
        steps[index] = step;
        onChange({ ...plan, steps });
    };

    const moveStep = (index, delta) => {
        const target = index + delta;
        if (target < 0 || target >= plan.steps.length) return;
        const steps = [...plan.steps];
        [steps[index], steps[target]] = [steps[target], steps[index]];
        onChange({ ...plan, steps });
    };

    const deleteStep = (index) => {
        if (plan.steps.length === 1) return;
        onChange({ ...plan, steps: plan.steps.filter((_, i) => i !== index) });
    };

    return (
        <div className="space-y-5">
            <button onClick={onBack} className="text-slate-400 hover:text-white text-sm font-medium">← All plans</button>

            <Card>
                {editing ? (
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="plan-name" className="block text-sm font-bold text-slate-400 mb-1.5">Name</label>
                            <input
                                id="plan-name" type="text" value={plan.name}
                                onChange={(e) => onChange({ ...plan, name: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-purple-500"
                            />
                        </div>
                        <div>
                            <label htmlFor="plan-goal" className="block text-sm font-bold text-slate-400 mb-1.5">Goal</label>
                            <input
                                id="plan-goal" type="text" value={plan.goal}
                                onChange={(e) => onChange({ ...plan, goal: e.target.value })}
                                placeholder="What this plan is meant to achieve"
                                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-purple-500"
                            />
                        </div>
                        <div>
                            <label htmlFor="plan-notes" className="block text-sm font-bold text-slate-400 mb-1.5">Notes and tips</label>
                            <textarea
                                id="plan-notes" rows={4} value={plan.notes}
                                onChange={(e) => onChange({ ...plan, notes: e.target.value })}
                                placeholder="Anything the person following this should know."
                                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white resize-y focus:outline-none focus:border-purple-500 text-sm"
                            />
                        </div>
                        <div>
                            <label htmlFor="plan-author" className="block text-sm font-bold text-slate-400 mb-1.5">Author</label>
                            <input
                                id="plan-author" type="text" value={plan.author}
                                onChange={(e) => onChange({ ...plan, author: e.target.value })}
                                placeholder="Your name, if you plan to share it"
                                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-purple-500"
                            />
                        </div>
                    </div>
                ) : (
                    <>
                        <h2 className="text-2xl font-bold text-white">{plan.name}</h2>
                        {plan.goal && <p className="text-slate-300 mt-1.5">{plan.goal}</p>}
                        {plan.author && <p className="text-xs text-slate-500 mt-2">by {plan.author}</p>}
                        {plan.notes && (
                            <p className="text-sm text-slate-400 mt-4 leading-relaxed whitespace-pre-wrap border-l-2 border-slate-800 pl-4">
                                {plan.notes}
                            </p>
                        )}
                    </>
                )}

                <div className="mt-5">
                    <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                        <span>{plan.completed.filter(id => plan.steps.some(s => s.id === id)).length} of {plan.steps.length} done</span>
                        <span>{progress}%</span>
                    </div>
                    <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-purple-600 to-emerald-500 transition-all duration-500" style={{ width: `${progress}%` }} />
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-5">
                    <button
                        onClick={() => setEditing(!editing)}
                        className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors"
                    >
                        {editing ? 'Done editing' : 'Edit plan'}
                    </button>
                    <button
                        onClick={() => onExport(plan)}
                        className="border border-slate-700 hover:border-purple-500 text-slate-300 hover:text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                        <Download size={14} /> Download .md
                    </button>
                    <button
                        onClick={() => onCopy(plan)}
                        className="border border-slate-700 hover:border-purple-500 text-slate-300 hover:text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                        <Copy size={14} /> Copy text
                    </button>
                    <button
                        onClick={() => onChange(resetProgress(plan))}
                        className="border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                        <RotateCcw size={14} /> Reset progress
                    </button>
                    <button
                        onClick={() => onDelete(plan.id)}
                        className="text-slate-600 hover:text-red-400 text-sm font-bold px-3 py-2 transition-colors ml-auto"
                    >
                        Delete
                    </button>
                </div>
            </Card>

            <div className="space-y-2">
                {plan.steps.map((step, index) => (
                    <StepRow
                        key={step.id}
                        step={step} index={index} editing={editing}
                        done={isStepDone(plan, step.id)}
                        isNext={upNext?.id === step.id}
                        onToggle={() => onChange({
                            ...plan,
                            completed: isStepDone(plan, step.id)
                                ? plan.completed.filter(id => id !== step.id)
                                : [...plan.completed, step.id]
                        })}
                        onRun={() => onRun(step)}
                        onChange={(next) => updateStep(index, next)}
                        onMove={(delta) => moveStep(index, delta)}
                        onDelete={() => deleteStep(index)}
                    />
                ))}
            </div>

            {editing && (
                <button
                    onClick={() => onChange({ ...plan, steps: [...plan.steps, createStep('read', '')] })}
                    className="w-full border border-dashed border-slate-700 hover:border-purple-500 text-slate-400 hover:text-white font-bold py-3 rounded-2xl transition-colors flex items-center justify-center gap-2"
                >
                    <Plus size={16} /> Add a step
                </button>
            )}
        </div>
    );
}

function Plans({ plans, onSavePlan, onDeletePlan, onRunStep, addNotification }) {
    const [openId, setOpenId] = useState(null);
    const [pasted, setPasted] = useState(null);
    const fileRef = useRef(null);
    const open = plans.find(p => p.id === openId);

    const exportPlan = (plan) => {
        const blob = new Blob([toMarkdown(plan)], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = planFilename(plan);
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        addNotification('Markdown file downloaded — send it to anyone.');
    };

    const copyPlan = async (plan) => {
        try {
            await navigator.clipboard.writeText(toMarkdown(plan));
            addNotification('Plan copied — paste it into a message.');
        } catch {
            addNotification('The browser blocked the clipboard. Use Download instead.');
        }
    };

    /** One entry point for both paths: a file and a paste are just text. */
    const acceptPlan = (text) => {
        try {
            const plan = parsePlan(text);
            onSavePlan(plan);
            setPasted(null);
            setOpenId(plan.id);
            addNotification(`Imported "${plan.name}".`);
        } catch (err) {
            addNotification(err.message || 'Could not read that plan.');
        }
    };

    const importFile = (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => acceptPlan(event.target.result);
        reader.onerror = () => addNotification('Could not read that file.');
        reader.readAsText(file);
    };

    if (open) {
        return (
            <div className="max-w-3xl mx-auto animate-in slide-in-from-bottom-4 pb-12">
                <PlanDetail
                    plan={open}
                    onChange={onSavePlan}
                    onDelete={(id) => { onDeletePlan(id); setOpenId(null); }}
                    onExport={exportPlan}
                    onCopy={copyPlan}
                    onRun={onRunStep}
                    onBack={() => setOpenId(null)}
                />
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6 animate-in slide-in-from-bottom-4 pb-12">
            <div>
                <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                    <Map className="text-purple-500 w-7 h-7" /> Training Plans
                </h1>
                <p className="text-slate-400 mt-2 max-w-2xl leading-relaxed">
                    Your own path through the app: an ordered list of drills and reads, with your goals and notes attached. Nothing here
                    is prescribed — write what works for you, tick steps off as you go, and share a plan as Markdown with anyone.
                </p>
            </div>

            <div className="flex flex-wrap gap-2">
                <button
                    onClick={() => { const plan = createPlan(); onSavePlan(plan); setOpenId(plan.id); }}
                    className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-5 py-3 rounded-xl transition-colors flex items-center gap-2"
                >
                    <Plus size={17} /> New plan
                </button>
                <button
                    onClick={() => fileRef.current?.click()}
                    className="border border-slate-700 hover:border-purple-500 text-slate-200 font-bold px-5 py-3 rounded-xl transition-colors flex items-center gap-2"
                >
                    <Upload size={17} /> Open a file
                </button>
                <button
                    onClick={() => setPasted(pasted === null ? '' : null)}
                    className="border border-slate-700 hover:border-purple-500 text-slate-200 font-bold px-5 py-3 rounded-xl transition-colors flex items-center gap-2"
                >
                    <Copy size={17} /> Paste a plan
                </button>
                <input
                    ref={fileRef} type="file" accept=".md,.markdown,.txt,.json,text/markdown,text/plain,application/json" className="hidden"
                    aria-label="Choose a plan file"
                    onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }}
                />
            </div>

            {pasted !== null && (
                <Card>
                    <label htmlFor="plan-paste" className="block text-sm font-bold text-slate-300 mb-1.5">
                        Paste a plan
                    </label>
                    <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                        Markdown from someone else, or written yourself. A title line, an optional
                        {' '}<code className="text-slate-400">&gt; goal</code>, then a numbered list where each step names one of:{' '}
                        {STEP_KIND_IDS.map(id => STEP_KINDS[id].label).join(', ')}.
                    </p>
                    <textarea
                        id="plan-paste" rows={8} value={pasted}
                        onChange={(e) => setPasted(e.target.value)}
                        placeholder={'# My plan\n\n> What it is for\n\n## Steps\n\n1. **Speed push drill** — warm up\n2. **Chunk Perception** — two runs'}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm font-mono resize-y focus:outline-none focus:border-purple-500"
                    />
                    <div className="flex gap-2 mt-3">
                        <button
                            onClick={() => acceptPlan(pasted)}
                            disabled={!pasted.trim()}
                            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:hover:bg-purple-600 text-white font-bold px-5 py-2.5 rounded-xl transition-colors"
                        >
                            Import
                        </button>
                        <button
                            onClick={() => setPasted(null)}
                            className="text-slate-400 hover:text-white font-bold px-4 py-2.5 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </Card>
            )}

            {plans.length > 0 && (
                <div className="space-y-2">
                    {plans.map(plan => {
                        const progress = planProgress(plan);
                        return (
                            <button
                                key={plan.id}
                                onClick={() => setOpenId(plan.id)}
                                className="w-full text-left bg-slate-900 border border-slate-800 hover:border-purple-500/60 rounded-2xl p-5 transition-colors"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <h3 className="font-bold text-white truncate">{plan.name}</h3>
                                        {plan.goal && <p className="text-sm text-slate-400 mt-1 line-clamp-2">{plan.goal}</p>}
                                        <p className="text-xs text-slate-600 mt-2">
                                            {plan.steps.length} step{plan.steps.length === 1 ? '' : 's'}
                                            {plan.author && ` · by ${plan.author}`}
                                        </p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <div className={`text-lg font-black ${progress === 100 ? 'text-emerald-400' : 'text-white'}`}>{progress}%</div>
                                        <div className="text-[10px] uppercase tracking-wider text-slate-600 font-bold">done</div>
                                    </div>
                                </div>
                                <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden mt-3">
                                    <div className="h-full bg-purple-600" style={{ width: `${progress}%` }} />
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            <Card>
                <h2 className="text-lg font-bold text-white mb-1">Start from an example</h2>
                <p className="text-sm text-slate-400 mb-4">
                    Two plans to copy and edit. They are starting points, not instructions — change anything that does not suit you.
                </p>
                <div className="space-y-2">
                    {STARTER_PLANS.map(starter => (
                        <div key={starter.name} className="bg-slate-950 border border-slate-800 rounded-2xl p-4 flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <h3 className="font-bold text-white text-sm">{starter.name}</h3>
                                <p className="text-xs text-slate-400 mt-1">{starter.goal}</p>
                                <p className="text-[11px] text-slate-600 mt-1.5">{starter.steps.length} steps</p>
                            </div>
                            <button
                                onClick={() => {
                                    const plan = createPlan({ ...starter, steps: starter.steps.map(s => createStep(s.kind, s.note)) });
                                    onSavePlan(plan);
                                    setOpenId(plan.id);
                                    addNotification(`Copied "${starter.name}" — edit it however you like.`);
                                }}
                                className="shrink-0 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"
                            >
                                Copy
                            </button>
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    );
}

export default Plans;
