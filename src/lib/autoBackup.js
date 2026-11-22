// Automatic backups to a folder the user picks, using the File System Access
// API (Chrome and Edge). The folder handle is kept in IndexedDB so it survives
// reloads; the browser still asks again for write access after a restart, which
// needs a click, so the UI shows an "Allow" button when that happens.
//
// Browsers without the API (Safari, Firefox, iPad) cannot write to a folder at
// all; there the manual export and the dashboard reminder remain.

import { todayKey } from './stats';

const DB_NAME = 'speedReadBackup';
const STORE = 'handles';
const KEY = 'folder';

export const BACKUP_PREFIX = 'speed-reading-backup-';

export const supportsFolderBackup = () =>
    typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idb(mode, fn) {
    const db = await openDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const req = fn(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(req?.result);
            tx.onerror = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
}

export const loadFolderHandle = () => idb('readonly', s => s.get(KEY)).catch(() => null);
const saveFolderHandle = (handle) => idb('readwrite', s => s.put(handle, KEY));
export const forgetFolder = () => idb('readwrite', s => s.delete(KEY));

/** Asks the user for a folder (needs a click). Returns the handle, or null if they cancelled. */
export async function chooseBackupFolder() {
    try {
        const handle = await window.showDirectoryPicker({ id: 'speed-ai-backups', mode: 'readwrite', startIn: 'documents' });
        await saveFolderHandle(handle);
        return handle;
    } catch (err) {
        if (err?.name === 'AbortError') return null;
        throw err;
    }
}

/** 'granted', 'prompt' (needs a click to allow again) or 'denied'; null when no folder is set. */
export async function folderPermission(handle, { request = false } = {}) {
    if (!handle) return null;
    const opts = { mode: 'readwrite' };
    let state = await handle.queryPermission?.(opts) ?? 'granted';
    if (state !== 'granted' && request) state = await handle.requestPermission?.(opts) ?? state;
    return state;
}

/**
 * Which backup files to delete so that only the newest `keep` remain. Only
 * files this app wrote (by name) are ever considered, never anything else in
 * the folder.
 */
export function filesToPrune(names, keep) {
    const ours = names.filter(n => n.startsWith(BACKUP_PREFIX) && n.endsWith('.json')).sort();
    return ours.slice(0, Math.max(0, ours.length - Math.max(1, keep)));
}

/**
 * Writes today's backup (replacing an earlier one from the same day) and
 * prunes old ones. Returns the file name written.
 */
export async function writeBackupToFolder(handle, backup, { keep = 14, date = new Date() } = {}) {
    const name = `${BACKUP_PREFIX}${todayKey(date)}.json`;
    const file = await handle.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(backup, null, 2));
    await writable.close();

    const names = [];
    for await (const [entryName, entry] of handle.entries()) {
        if (entry.kind === 'file') names.push(entryName);
    }
    for (const old of filesToPrune(names, keep)) {
        await handle.removeEntry(old).catch(() => {});
    }
    return name;
}

/** Whether an automatic backup is due: never made, or older than `everyHours`. */
export function autoBackupDue(lastAt, everyHours, now = Date.now()) {
    if (!lastAt) return true;
    const last = Date.parse(lastAt);
    if (!Number.isFinite(last)) return true;
    return now - last >= everyHours * 3600 * 1000;
}
