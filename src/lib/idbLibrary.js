// Lightweight IndexedDB persistence for the reading library so large PDFs and
// EPUBs are not capped by localStorage's ~5 MB limit.

const DB_NAME = 'speedReadDB';
const STORE_NAME = 'library';
const KEY = 'entries';

function openDb() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
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

export async function saveLibraryIdb(entries) {
    try {
        const db = await openDb();
        if (!db) return false;
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const req = tx.objectStore(STORE_NAME).put(entries, KEY);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
        return true;
    } catch {
        return false;
    }
}
