import { FolderOpen, HardDriveDownload, ShieldAlert } from 'lucide-react';

const EVERY = [
    { hours: 6, label: 'Every 6 hours' },
    { hours: 24, label: 'Daily' },
    { hours: 168, label: 'Weekly' }
];

const when = (iso) => {
    if (!iso) return 'not yet';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? 'not yet' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/**
 * Automatic backups to a folder on this computer (Chrome and Edge). Shows the
 * folder, how often, how many files to keep, when the last one was written,
 * and an "Allow" button for when the browser needs permission again.
 */
export default function FolderBackupPanel({ backup }) {
    if (!backup) return null;
    const { supported, folderName, folderState, config, lastAt, onChooseFolder, onAllow, onBackupNow, onStop, onChange } = backup;

    if (!supported) {
        return (
            <div className="border border-slate-800 rounded-2xl p-4 text-xs text-slate-400 space-y-1">
                <div className="font-bold text-slate-300 flex items-center gap-1.5"><HardDriveDownload size={14} /> Automatic backups</div>
                <p>This browser cannot save files to a folder by itself (Safari, Firefox and iPad can&apos;t). Use Export backup above; the dashboard reminds you when one is due. Chrome or Edge on a computer can back up automatically.</p>
            </div>
        );
    }

    return (
        <div className="border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="font-bold text-white text-sm flex items-center gap-1.5"><HardDriveDownload size={15} /> Automatic backups</div>
                    <p className="text-xs text-slate-400 mt-0.5">
                        {folderName
                            ? <>Saves a dated backup file to <span className="text-slate-200 font-medium">&quot;{folderName}&quot;</span> and keeps the newest {config.keep}.</>
                            : 'Pick a folder (OneDrive, Dropbox or a USB drive works well) and a backup is saved there on a schedule and after each session.'}
                    </p>
                </div>
                {folderName && (
                    <button
                        type="button" role="switch" aria-checked={config.enabled} aria-label="Automatic backups"
                        onClick={() => onChange({ enabled: !config.enabled })}
                        className={`w-10 h-6 rounded-full relative shrink-0 transition-colors ${config.enabled ? 'bg-purple-600' : 'bg-slate-700'}`}
                    >
                        <span className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${config.enabled ? 'left-5' : 'left-1'}`} />
                    </button>
                )}
            </div>

            {folderName && folderState === 'prompt' && (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-amber-950/30 border border-amber-800/50 px-3 py-2 text-xs text-amber-200">
                    <span className="flex items-center gap-1.5"><ShieldAlert size={13} /> Paused: the browser needs your OK to write to this folder again.</span>
                    <button type="button" onClick={onAllow} className="font-bold text-amber-300 hover:text-amber-100">Allow</button>
                </div>
            )}
            {folderName && folderState === 'missing' && (
                <p className="text-xs text-red-300">That folder no longer exists (moved or deleted). Choose a folder again.</p>
            )}
            {folderName && folderState === 'denied' && (
                <p className="text-xs text-red-300">Writing to this folder was refused. Choose the folder again to fix it.</p>
            )}

            {folderName && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                    <label className="text-slate-400">
                        How often
                        <select
                            value={config.everyHours}
                            onChange={(e) => onChange({ everyHours: Number(e.target.value) })}
                            className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white"
                        >
                            {EVERY.map(o => <option key={o.hours} value={o.hours}>{o.label}</option>)}
                        </select>
                    </label>
                    <label className="text-slate-400">
                        Keep
                        <select
                            value={config.keep}
                            onChange={(e) => onChange({ keep: Number(e.target.value) })}
                            className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white"
                        >
                            {[7, 14, 30, 90].map(n => <option key={n} value={n}>Newest {n} files</option>)}
                        </select>
                    </label>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2 text-xs">
                <button type="button" onClick={onChooseFolder} className="inline-flex items-center gap-1.5 border border-slate-700 hover:border-purple-500 text-slate-200 font-bold px-3 py-1.5 rounded-lg">
                    <FolderOpen size={13} /> {folderName ? 'Change folder' : 'Choose a backup folder'}
                </button>
                {folderName && (
                    <>
                        <button type="button" onClick={onBackupNow} className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-3 py-1.5 rounded-lg">Back up now</button>
                        <button type="button" onClick={onStop} className="text-slate-500 hover:text-slate-300 px-2">Stop using this folder</button>
                        <span className="text-slate-500 ml-auto">Last automatic backup: {when(lastAt)}</span>
                    </>
                )}
            </div>
        </div>
    );
}
