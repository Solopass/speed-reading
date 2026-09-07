import { useState } from 'react';
import { Check, ClipboardCopy, ExternalLink } from 'lucide-react';
import { extractJson, manualPrompt } from '../lib/ai';

// Any assistant that can return JSON will do. These are just shortcuts.
const ASSISTANTS = [
    { label: 'ChatGPT', href: 'https://chatgpt.com' },
    { label: 'Claude', href: 'https://claude.ai' },
    { label: 'Gemini', href: 'https://gemini.google.com' }
];

function Step({ n, title, children, done }) {
    return (
        <div className="flex gap-3">
            <div className={`shrink-0 w-6 h-6 rounded-full grid place-items-center text-xs font-bold mt-0.5 ${
                done ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-400'
            }`}>
                {done ? <Check size={13} strokeWidth={3} /> : n}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-200 mb-2">{title}</div>
                {children}
            </div>
        </div>
    );
}

/**
 * The no-API-key path. Rather than disabling the AI features, this hands you
 * the exact prompt to paste into whatever assistant you already have open, and
 * takes the reply back as pasted JSON.
 *
 * The prompt is always visible in a details block, not only copied to the
 * clipboard: clipboard writes fail silently on insecure origins and under some
 * permission policies, and a feature that quietly does nothing is worse than
 * one that asks you to select some text.
 */
export default function ManualAiPanel({ spec, disabled, onResult, addNotification }) {
    const [reply, setReply] = useState('');
    const [error, setError] = useState(null);
    const [copied, setCopied] = useState(false);

    const text = spec ? manualPrompt(spec) : '';

    const copyPrompt = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
            addNotification?.('Prompt copied. Paste it into your assistant.');
        } catch {
            addNotification?.('Could not reach the clipboard — open "Show the prompt" and copy it by hand.');
        }
    };

    const load = () => {
        try {
            const parsed = extractJson(reply);
            // Cleared only once the consumer has accepted it. onResult rejects
            // replies that parse but are missing what the caller needs, and
            // wiping the box first would throw away the text the error is
            // asking you to fix.
            onResult(parsed);
            setError(null);
            setReply('');
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div className="border border-blue-900/50 bg-blue-950/10 rounded-2xl p-5 space-y-5">
            <div>
                <div className="text-sm font-bold text-blue-300 mb-1">No API key needed</div>
                <p className="text-xs text-slate-400 leading-relaxed">
                    Copy the prompt into any AI assistant you already use, then paste its answer back here. Takes about twenty seconds
                    and works with a free account.
                </p>
            </div>

            <Step n="1" title="Copy the prompt" done={copied}>
                <button
                    onClick={copyPrompt} disabled={disabled}
                    className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white text-sm font-bold py-2.5 rounded-lg transition-colors"
                >
                    <ClipboardCopy size={15} /> {copied ? 'Copied' : 'Copy prompt'}
                </button>
                {disabled && <p className="text-[11px] text-amber-400/80 mt-2">Fill in the field above first.</p>}

                {!disabled && (
                    <details className="group mt-2">
                        <summary className="text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer select-none">
                            Show the prompt
                        </summary>
                        <textarea
                            readOnly value={text} rows={6} onFocus={(e) => e.target.select()}
                            aria-label="The prompt to paste into your assistant"
                            className="w-full mt-2 bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] text-slate-400 font-mono resize-y"
                        />
                    </details>
                )}
            </Step>

            <Step n="2" title="Paste it into an assistant and copy the reply">
                <div className="flex flex-wrap gap-2">
                    {ASSISTANTS.map(a => (
                        <a
                            key={a.label} href={a.href} target="_blank" rel="noreferrer noopener"
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white border border-slate-800 hover:border-slate-600 rounded-lg px-3 py-1.5 transition-colors"
                        >
                            {a.label} <ExternalLink size={11} />
                        </a>
                    ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-2">
                    Opens in a new tab. Any assistant works — these are just shortcuts.
                </p>
            </Step>

            <Step n="3" title="Paste the reply back here">
                <textarea
                    value={reply}
                    onChange={(e) => { setReply(e.target.value); setError(null); }}
                    disabled={disabled}
                    placeholder={'Paste the whole reply — extra chatter and code fences are fine.'}
                    rows={3}
                    aria-label="The assistant's reply"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white resize-y focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-40"
                />
                {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
                <button
                    onClick={load} disabled={disabled || !reply.trim()}
                    className="w-full mt-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-bold py-2.5 rounded-lg transition-colors"
                >
                    Load {spec?.label ?? 'result'}
                </button>
            </Step>
        </div>
    );
}
