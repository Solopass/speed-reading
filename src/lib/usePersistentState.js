import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Reads one localStorage key through a migration. Any failure (storage
 * blocked, corrupt JSON, a migration that throws) falls back rather than
 * blanking the app.
 */
export function loadStored(storage, key, migrate, fallback) {
    try {
        const raw = storage?.getItem(key);
        return migrate(raw ? JSON.parse(raw) : null);
    } catch {
        return typeof fallback === 'function' ? fallback() : fallback;
    }
}

export function saveStored(storage, key, value) {
    try {
        storage?.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        // Quota exceeded or storage blocked: keep running on in-memory state.
        return false;
    }
}

const storage = () => {
    try { return window.localStorage; } catch { return null; }
};

/**
 * useState backed by one localStorage key. Each key writes only when its own
 * value changes, instead of one effect re-serialising the whole profile
 * (library text included) on every settings tweak.
 */
export default function usePersistentState(key, migrate, fallback, onSaveError) {
    const [value, setValue] = useState(() => loadStored(storage(), key, migrate, fallback));
    const onErrorRef = useRef(onSaveError);
    useLayoutEffect(() => { onErrorRef.current = onSaveError; });
    // Also runs on mount, so a migrated value is written back once instead of
    // being re-derived (with fresh fallback ids or dates) on every load.
    useEffect(() => {
        if (!saveStored(storage(), key, value)) onErrorRef.current?.(key);
    }, [key, value]);
    return [value, setValue];
}
