import { useEffect, useState } from 'react';
import { MonitorDown, Share } from 'lucide-react';
import { canPromptInstall, isInstalled, isIos, promptInstall, subscribeInstall } from '../lib/install';

/**
 * Install the trainer as an app: its own window, its own icon, and it opens
 * without a connection. Chrome and Edge offer a button; on iPhone and iPad
 * Safari's Share menu does it.
 */
export default function InstallAppPanel() {
    const [, setTick] = useState(0);
    useEffect(() => subscribeInstall(() => setTick(t => t + 1)), []);

    const installed = isInstalled();
    const ios = isIos();
    const canPrompt = canPromptInstall();

    return (
        <div className="border border-slate-800 rounded-2xl p-4 space-y-2">
            <div className="font-bold text-white text-sm flex items-center gap-1.5"><MonitorDown size={15} /> Install as an app</div>
            {installed ? (
                <p className="text-xs text-emerald-300">You are using the installed app. It opens from its own icon and works offline.</p>
            ) : canPrompt ? (
                <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-400">Opens in its own window from an icon, and works without a connection. Your data stays the same.</p>
                    <button type="button" onClick={() => promptInstall()} className="shrink-0 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg">
                        Install app
                    </button>
                </div>
            ) : ios ? (
                <p className="text-xs text-slate-400 flex items-start gap-1.5">
                    <Share size={13} className="shrink-0 mt-0.5" />
                    In Safari, tap Share, then &quot;Add to Home Screen&quot;. It then opens full screen from its own icon and works offline.
                </p>
            ) : (
                <p className="text-xs text-slate-400">
                    Use Chrome or Edge on the built app (the online demo, or <code className="text-slate-300">bun run preview</code> on this PC) and an Install button appears here.
                    Already installed, or in another browser? Look for &quot;Install&quot; in the browser&apos;s menu.
                </p>
            )}
        </div>
    );
}
