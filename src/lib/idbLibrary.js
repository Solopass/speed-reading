// Lightweight IndexedDB persistence for the reading library so large PDFs and
// EPUBs are not capped by localStorage's ~5 MB limit.

const DB_NAME = 'speedReadDB';
const STORE_NAME = 'library';
const KEY = 'entries';

// One connection for the app's lifetime. Opening a new one per save leaked a
// connection every time the library changed.
let dbPromise = null;

function openDb() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    dbPromise ??= new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
        };
        req.onsuccess = () => {
            const db = req.result;
            // Another tab upgrading the schema: let go so it can proceed, and reopen next time.
            db.onversionchange = () => { db.close(); dbPromise = null; };
            resolve(db);
        };
        req.onerror = () => reject(req.error);
    }).catch(err => { dbPromise = null; throw err; });
    return dbPromise;
}

export async function loadLibraryIdb() {
    try {
        const db = await openDb();
        if (!db) return null;
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(KEY);
            req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : null);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}

async function writeEntries(entries) {
    const db = await openDb();
    if (!db) return false;
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(entries, KEY);
        // Resolve on commit, not on the request: a put can succeed and the
        // transaction still abort (quota exceeded) afterwards.
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
        tx.onerror = () => reject(tx.error);
    });
    return true;
}

// Writes are serialised and coalesced: while one is in flight only the newest
// pending value is kept, so an older library can never land after a newer one.
let inFlight = null;
let pending = null;

/**
 * Saves the library. Resolves true when the newest value given so far has
 * been committed, false if writing failed or IndexedDB is unavailable.
 */
export function saveLibraryIdb(entries) {
    pending = { entries };
    if (!inFlight) {
        inFlight = (async () => {
            let ok = true;
            while (pending) {
                const { entries: next } = pending;
                pending = null;
                try { ok = await writeEntries(next); } catch { ok = false; }
            }
            inFlight = null;
            return ok;
        })();
    }
    return inFlight;
}
