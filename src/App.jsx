import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { hasApiKey } from './lib/gemini';
import { listModels } from './lib/ollama';
import { DEFAULT_AI_SETTINGS, migrateAiSettings, resolveAi } from './lib/aiProvider';
import { generateQuestionsFor } from './lib/ai';
import {
    DEFAULT_STATS, HISTORY_LIMIT, addBaselineSample, adaptTarget, backupReminderDue, createSession,
    markBackedUp, migrateHistory, migrateStats, nextStreak, snoozeBackup, todayKey
} from './lib/stats';
import { CALIBRATION_PASSAGES } from './lib/calibration';
import { intensityLabel, nextPushIntensity } from './lib/protocol';
import { DRILL_META, MAX_DRILL_HISTORY, migrateDrills } from './lib/drillStats';
import { createBackup, downloadBackup, readBackup } from './lib/backup';
import { buildDrillPack, newPackId, normalizePack } from './lib/drillPack';
import { loadFrequencyRank } from './lib/vocab';
import { packFromHash } from './lib/packShare';
import SharedPackPrompt from './components/SharedPackPrompt';
import {
    autoBackupDue, chooseBackupFolder, folderPermission, forgetFolder, loadFolderHandle, supportsFolderBackup, writeBackupToFolder
} from './lib/autoBackup';
import { DEFAULT_READING, normalizePreset, normalizeReading } from './lib/readingStyle';
import { STEP_KINDS, migratePlans, removePlan, upsertPlan } from './lib/plans';
import {
    addPassageBookmark, createEntry, findEntry, migrateLibrary, recallQueue, recordAttempt,
    recordProgress, removeEntry, removePassageBookmark, resumePoint, toPassage, upsertEntry
} from './lib/library';
import { dueItems, migrateVocab } from './lib/vocab';
import {
    addBookmark, chapterPassage, completeChapter, isBook, nextChapterIndex, recordChapterProgress, removeBookmark, snippetAt
} from './lib/book';
import { pickNextAction } from './lib/nextAction';
import { DEFAULT_THEME, applyTheme, resolveTheme } from './lib/theme';
import usePersistentState from './lib/usePersistentState';
import { loadLibraryIdb, saveLibraryIdb } from './lib/idbLibrary';
import { remapWordIndex } from './lib/readerNav';
import { PhoneHeader, PhoneTabBar, Sidebar } from './components/AppNav';
import Toasts from './components/Toasts';
import Library from './views/Library';
import Reader from './views/Reader';
import RecallCheck from './views/RecallCheck';
import SpeedPush from './components/SpeedPush';

// Views that pull in the chart library or are rarely opened load on demand,
// which keeps the first download small.
const Dashboard = lazy(() => import('./views/Dashboard'));
const Analytics = lazy(() => import('./views/Analytics'));
const Tools = lazy(() => import('./views/Tools'));
const Plans = lazy(() => import('./views/Plans'));
const Guide = lazy(() => import('./views/Guide'));
const AICoach = lazy(() => import('./views/AICoach'));
const VideoSummary = lazy(() => import('./views/VideoSummary'));
const ReadingEnvironment = lazy(() => import('./views/ReadingEnvironment'));
const SettingsPanel = lazy(() => import('./views/SettingsPanel'));
const Vocabulary = lazy(() => import('./views/Vocabulary'));
const Documents = lazy(() => import('./views/Documents'));
const Upload = lazy(() => import('./views/Upload'));

/**
 * The installed app should work offline, but the screens above load on demand,
 * so a screen never opened would be missing. In the production build, once the
 * app is idle, they are all fetched once (the service worker keeps them).
 */
function warmOfflineCache() {
    const loaders = [
        () => import('./views/Dashboard'), () => import('./views/Analytics'), () => import('./views/Tools'),
        () => import('./views/Plans'), () => import('./views/Guide'), () => import('./views/AICoach'),
        () => import('./views/VideoSummary'), () => import('./views/ReadingEnvironment'), () => import('./views/SettingsPanel'),
        () => import('./views/Vocabulary'), () => import('./views/Documents'), () => import('./views/Upload'),
        () => import('./lib/vocab').then(m => m.loadFrequencyRank())
    ];
    for (const load of loaders) load().catch(() => {});
}

const DEFAULT_SETTINGS = {
    reading: DEFAULT_READING,
    goalWpm: 2000,
    ...DEFAULT_AI_SETTINGS,
    verifyQuestions: true,
    baseWpm: 300,
    readerWpm: null,
    skimWpm: null,
    chunkSize: 1,
    smartChunks: true,
    readerMode: 'rsvp',
    font: 'font-sans',
    theme: DEFAULT_THEME,
    autoAdaptive: true,
    punctuationPacing: true,
    bionicReading: false,
    rpgLeveling: true,
    audioSyncEnabled: false
};

// Settings are merged over the defaults, not substituted for them: a setting
// added in a later build would otherwise be undefined for anyone who already
// has saved settings.
const migrateSettings = (raw) => ({ ...DEFAULT_SETTINGS, ...(raw ? migrateAiSettings(raw) : {}) });

/** Reading, drilling and retention checks take the whole screen. */
const FOCUS_VIEWS = new Set(['reader', 'push', 'recall']);

const prefersDarkQuery = () => {
    try { return window.matchMedia('(prefers-color-scheme: dark)'); } catch { return null; }
};

function ViewFallback() {
    return (
        <div className="h-64 grid place-items-center text-slate-500" aria-busy="true">
            <Activity className="animate-spin" size={22} />
        </div>
    );
}

export default function App() {
    const [currentView, setCurrentView] = useState('dashboard');

    // Set when the browser refuses a write (storage full or blocked), so the
    // user is told once instead of believing their progress is saved.
    const [saveFailed, setSaveFailed] = useState(false);
    const onSaveError = useCallback(() => setSaveFailed(true), []);

    const [settings, setSettings] = usePersistentState('speedReadSettings', migrateSettings, () => ({ ...DEFAULT_SETTINGS }), onSaveError);
    const [userStats, setUserStats] = usePersistentState('speedReadStats', migrateStats, () => ({ ...DEFAULT_STATS }), onSaveError);
    const [sessionHistory, setSessionHistory] = usePersistentState('speedReadHistory', (raw) => migrateHistory(raw ?? []), [], onSaveError);
    const [library, setLibrary] = useState(() => {
        try {
            const raw = localStorage.getItem('speedReadLibrary');
            return raw ? migrateLibrary(JSON.parse(raw)) : [];
        } catch {
            return [];
        }
    });
    const libraryReadyRef = useRef(false);
    // Also as state, so automatic backups wait until the full library has loaded
    // (a large library starts out empty here until IndexedDB answers).
    const [libraryLoaded, setLibraryLoaded] = useState(false);
    const latestLibraryRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        loadLibraryIdb().then((stored) => {
            if (cancelled) return;
            libraryReadyRef.current = true;
            setLibraryLoaded(true);
            if (stored !== null) {
                setLibrary(migrateLibrary(stored));
            } else {
                setLibrary(prev => {
                    if (prev.length > 0) saveLibraryIdb(prev);
                    return prev;
                });
            }
        });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!libraryReadyRef.current) return;
        // localStorage keeps a copy while the library is small enough, as a
        // fallback if IndexedDB is unavailable. A large library is only
        // dropped from it once IndexedDB has confirmed the write; if that write
        // fails the user is warned instead of silently losing the library.
        let json = null;
        try { json = JSON.stringify(library); } catch { json = null; }
        const small = json !== null && json.length * 2 < 3_000_000;
        if (small) {
            try { localStorage.setItem('speedReadLibrary', json); } catch { /* IndexedDB is the primary store */ }
        }
        latestLibraryRef.current = library;
        saveLibraryIdb(library).then((ok) => {
            if (!ok) { onSaveError('speedReadLibrary'); return; }
            // Coalesced writes share one promise; only the newest library may
            // clear the fallback, or a stale "large" save would remove the copy
            // a newer, small library just wrote.
            if (!small && latestLibraryRef.current === library) {
                try { localStorage.removeItem('speedReadLibrary'); } catch { /* nothing to clean up */ }
            }
        });
    }, [library, onSaveError]);
    const [plans, setPlans] = usePersistentState('speedReadPlans', (raw) => migratePlans(raw ?? []), [], onSaveError);
    const [drills, setDrills] = usePersistentState('speedReadDrills', (raw) => migrateDrills(raw ?? []), [], onSaveError);
    // Drill packs: Neuro-Drill material made from your documents (lib/drillPack.js).
    const [drillPacks, setDrillPacks] = usePersistentState('speedReadDrillPacks', (raw) => (Array.isArray(raw) ? raw.map(normalizePack).filter(Boolean) : []), [], onSaveError);
    // Opened from a shared pack link (#pack=…): ask before adding it, then clear the address.
    const [sharedPack, setSharedPack] = useState(null);
    const [vocab, setVocab] = usePersistentState('speedReadVocab', migrateVocab, [], onSaveError);
    const [customPresets, setCustomPresets] = usePersistentState('speedReadPresets', (raw) => (Array.isArray(raw) ? raw.map(normalizePreset).filter(Boolean) : []), [], onSaveError);
    const [popoutWin, setPopoutWin] = useState(null);

    const [activePassage, setActivePassage] = useState(null);
    // Set when a passage is opened purely to re-test retention, so the result
    // is recorded against the spaced schedule rather than as a fresh read.
    const [isRecall, setIsRecall] = useState(false);
    const [returnView, setReturnView] = useState('library');

    // --- Theme ---------------------------------------------------------------
    const [prefersDark, setPrefersDark] = useState(() => prefersDarkQuery()?.matches ?? true);
    useEffect(() => {
        const query = prefersDarkQuery();
        if (!query) return undefined;
        const onChange = (e) => setPrefersDark(e.matches);
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, []);
    const theme = resolveTheme(settings.theme, prefersDark);
    useEffect(() => { applyTheme(theme); }, [theme]);

    // --- Toasts ----------------------------------------------------------------
    // A counter, not Date.now(): two toasts in the same millisecond used to
    // share an id, so dismissing one removed both.
    const [notifications, setNotifications] = useState([]);
    const toastId = useRef(0);
    const dismissNotification = useCallback((id) => setNotifications(prev => prev.filter(n => n.id !== id)), []);
    const addNotification = useCallback((msg, tone = 'info') => {
        toastId.current += 1;
        const id = toastId.current;
        setNotifications(prev => [...prev.slice(-3), { id, msg, tone }]);
        setTimeout(() => dismissNotification(id), 4500);
    }, [dismissNotification]);

    useEffect(() => {
        if (!window.location.hash.startsWith('#pack=')) return;
        const hash = window.location.hash;
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        packFromHash(hash).then((pack) => {
            if (pack) setSharedPack(pack);
            else addNotification('That share link is damaged or incomplete, so no pack was added.');
        });
        // Runs once, on opening the app.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const warnedSave = useRef(false);
    useEffect(() => {
        if (!saveFailed || warnedSave.current) return;
        warnedSave.current = true;
        addNotification('This browser is refusing to save. Export a backup from Settings now so nothing is lost.');
    }, [saveFailed, addNotification]);

    const updateSettings = (newSettings) => setSettings(prev => ({ ...prev, ...newSettings }));

    // Always read through the normalizer, so a stored or imported value that is
    // out of range degrades to something usable rather than blanking the page.
    const reading = normalizeReading(settings.reading);
    // Merges into the latest stored value, so several quick changes (the
    // reader's settings drawer) cannot overwrite one another.
    const patchReading = (patch) => setSettings(prev => ({ ...prev, reading: normalizeReading({ ...prev.reading, ...patch }) }));

    // Bumped by Upload's "Browse free books" so Documents opens the shelf. Cleared whenever the
    // view leaves Documents (the reader is opened without navigate()), so coming back from a
    // book does not scroll to the shelf again.
    const [freeBooksRequest, setFreeBooksRequest] = useState(0);
    const [viewSeen, setViewSeen] = useState(currentView);
    if (viewSeen !== currentView) {
        setViewSeen(currentView);
        if (currentView !== 'documents' && freeBooksRequest) setFreeBooksRequest(0);
    }
    const navigate = (view) => {
        setCurrentView(view);
        document.getElementById('main-scroll')?.scrollTo({ top: 0 });
    };

    // Live state of the local Ollama server. Checked when the local provider is
    // selected or its address changes, and again on demand from Settings.
    const [localAi, setLocalAi] = useState({ status: 'checking', models: [] });
    const [localCheck, setLocalCheck] = useState(0);
    const recheckLocalAi = useCallback(() => setLocalCheck(n => n + 1), []);

    useEffect(() => {
        if (settings.aiProvider !== 'local') return undefined;
        const controller = new AbortController();
        queueMicrotask(() => {
            if (!controller.signal.aborted) setLocalAi(prev => ({ ...prev, status: 'checking' }));
        });
        listModels(settings.ollamaUrl, { signal: controller.signal })
            .then(models => setLocalAi({ status: 'ready', models }))
            .catch(error => {
                if (controller.signal.aborted) return;
                setLocalAi({ status: 'unreachable', models: [], error: error.message });
            });
        return () => controller.abort();
    }, [settings.aiProvider, settings.ollamaUrl, localCheck]);

    // One decision for every AI feature. With nothing direct available the
    // features stay usable through the copy/paste panel rather than disappearing.
    const apiKeyPresent = hasApiKey();
    const ai = resolveAi({ settings, geminiKey: apiKeyPresent, local: localAi });

    /**
     * Everything you read gets saved, so a passage can be resumed, replayed, or
     * re-quizzed days later.
     */
    const saveToLibrary = (passageData, source, kind = 'read') => {
        const entry = createEntry({ ...passageData, source, kind });
        setLibrary(prev => upsertEntry(prev, entry));
        return entry;
    };

    const startPassage = (passageData, { source = 'import', save = true, recall = false, returnTo = 'library' } = {}) => {
        const entry = save ? saveToLibrary(passageData, source) : null;
        setActivePassage({ ...passageData, id: entry?.id ?? passageData.id });
        setIsRecall(recall);
        setReturnView(returnTo);
        setCurrentView('reader');
    };

    /**
     * A baseline read. `fresh` starts a new baseline (a retake); otherwise the
     * read is averaged into the current one.
     */
    const startBaseline = (index = 0, { fresh = true } = {}) => {
        const passage = CALIBRATION_PASSAGES[Math.min(index, CALIBRATION_PASSAGES.length - 1)];
        startPassage({ ...passage, baselineFresh: fresh }, { save: false, returnTo: 'dashboard' });
    };

    /** Opens one chapter of a book, at its saved position or at `resumeFrom` (a bookmark). */
    const openBookChapter = (bookId, chapterIndex, resumeFrom = null, returnTo = 'library') => {
        const book = findEntry(library, bookId);
        if (!isBook(book) || !book.chapters[chapterIndex]) return;
        setActivePassage(chapterPassage(book, chapterIndex, resumeFrom));
        setIsRecall(false);
        setReturnView(returnTo);
        setCurrentView('reader');
    };

    /** Books and documents live in IndexedDB so large EPUBs and PDFs are not capped by localStorage. */
    const saveBook = (book) => {
        // One copy per free book: a download that finished after the shelf was reopened must not add a twin.
        const sameFreeBook = (item) => Boolean(book.freeBookId) && item?.freeBookId === book.freeBookId;
        if (library.some(sameFreeBook)) {
            addNotification(`"${book.title}" is already in your books.`);
            return false;
        }
        setLibrary(prev => (prev.some(sameFreeBook) ? prev : upsertEntry(prev, book)));
        addNotification(`Added "${book.title}" as a book: ${book.chapters.length} chapters.`, 'success');
        return true;
    };

    const bookmarkHere = ({ index, note = '' }) => {
        const p = activePassage;
        if (!p || p.isCalibration) return;
        const snippet = snippetAt(p.text ?? '', index);
        if (p.bookId) {
            setLibrary(prev => addBookmark(prev, p.bookId, { chapter: p.chapterIndex, index, snippet, note }));
            addNotification(note.trim() ? 'Bookmark & note saved.' : 'Bookmarked.', 'success');
            return;
        }
        if (p.id) {
            setLibrary(prev => addPassageBookmark(prev, p.id, { index, snippet, note }));
            addNotification(note.trim() ? 'Bookmark & note saved.' : 'Bookmarked.', 'success');
        }
    };

    const startPushDrill = (drillPassage, { source = 'builtin', save = true, returnTo = 'library' } = {}) => {
        const entry = save ? saveToLibrary(drillPassage, source, 'push') : null;
        setActivePassage({ ...drillPassage, id: entry?.id ?? drillPassage.id });
        setIsRecall(false);
        setReturnView(returnTo);
        setCurrentView('push');
    };

    /**
     * Reopens a stored passage. A retention re-test goes straight to the
     * questions — re-reading first would measure nothing.
     */
    const openSaved = (id, { recall = false, returnTo = 'library', resumeAt = null } = {}) => {
        const entry = findEntry(library, id);
        if (!entry) return;
        if (isBook(entry)) { openBookChapter(id, nextChapterIndex(entry), resumeAt, returnTo); return; }
        const passage = toPassage(entry);
        setActivePassage(resumeAt !== null ? { ...passage, resumeFrom: resumeAt } : passage);
        setIsRecall(recall);
        setReturnView(returnTo);
        if (recall) setCurrentView('recall');
        else setCurrentView(entry.kind === 'push' ? 'push' : 'reader');
    };

    /**
     * Retention checks record against the passage but never enter session
     * history: no reading happened, so there is no speed to pair the score with.
     */
    const finishRecall = (score) => {
        setLibrary(prev => recordAttempt(prev, activePassage.id, { wpm: null, score, kind: 'recall' }));
        setActivePassage(null);
        setIsRecall(false);
        setCurrentView('dashboard');
        addNotification(`Retention check: ${score}% recalled.`, 'success');
    };

    // Drill results are their own history: they measure visual span and search
    // speed, not reading, so they never touch session stats or the target WPM.
    const handleDrillComplete = (result) => {
        setDrills(prev => [...prev, result].slice(-MAX_DRILL_HISTORY));
        // Each drill's own label and unit (ms, words, seconds, ms/word).
        const meta = DRILL_META[result.kind];
        addNotification(meta ? `${meta.label}: ${result.metric}${meta.unit}.` : 'Drill saved.', 'success');
    };

    const currentBackup = () => createBackup({ settings, stats: userStats, history: sessionHistory, library, drills, plans, vocab, presets: customPresets, drillPacks });

    // --- Automatic backups to a folder (see lib/autoBackup.js) ----------------
    useEffect(() => {
        if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return undefined;
        const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 3000));
        const id = idle(() => warmOfflineCache());
        return () => (window.cancelIdleCallback ?? clearTimeout)(id);
    }, []);

    const [backupFolder, setBackupFolder] = useState(null);
    const [backupFolderState, setBackupFolderState] = useState(null);
    useEffect(() => {
        if (!supportsFolderBackup()) return;
        loadFolderHandle().then(async (handle) => {
            if (!handle) return;
            setBackupFolder(handle);
            setBackupFolderState(await folderPermission(handle).catch(() => 'prompt'));
        });
    }, []);
    const autoBackup = { enabled: false, everyHours: 24, keep: 14, ...(settings.autoBackup ?? {}) };

    const backupInFlightRef = useRef(false);
    const runFolderBackup = async ({ manual = false } = {}) => {
        if (!backupFolder || backupInFlightRef.current) return false;
        if (!libraryReadyRef.current) return false;
        backupInFlightRef.current = true;
        try {
            return await writeFolderBackup(manual);
        } finally {
            backupInFlightRef.current = false;
        }
    };
    const writeFolderBackup = async (manual) => {
        const state = await folderPermission(backupFolder, { request: manual }).catch(() => 'prompt');
        setBackupFolderState(state);
        if (state !== 'granted') {
            if (manual) addNotification('The browser did not allow writing to that folder.');
            return false;
        }
        try {
            const name = await writeBackupToFolder(backupFolder, currentBackup(), { keep: autoBackup.keep });
            updateSettings({ autoBackupLastAt: new Date().toISOString() });
            setUserStats(prev => markBackedUp(prev));
            if (manual) addNotification(`Backed up to ${backupFolder.name}/${name}.`, 'success');
            return true;
        } catch (error) {
            if (error?.name === 'NotFoundError') {
                // The folder was moved or deleted: stop trying until a folder is chosen again.
                setBackupFolderState('missing');
                addNotification(`The backup folder "${backupFolder.name}" is gone. Choose a folder again in Settings.`);
            } else {
                addNotification(`Automatic backup failed: ${error.message || 'could not write the file'}.`);
            }
            return false;
        }
    };
    // The scheduler calls the latest version, so it always backs up current data.
    const runFolderBackupRef = useRef(runFolderBackup);
    useLayoutEffect(() => { runFolderBackupRef.current = runFolderBackup; });
    // Due on open, after each finished session, and checked hourly.
    useEffect(() => {
        if (!autoBackup.enabled || backupFolderState !== 'granted' || !libraryLoaded) return undefined;
        const check = () => {
            if (autoBackupDue(settings.autoBackupLastAt, autoBackup.everyHours)) runFolderBackupRef.current();
        };
        check();
        const id = setInterval(check, 60 * 60 * 1000);
        return () => clearInterval(id);
    }, [autoBackup.enabled, autoBackup.everyHours, backupFolderState, settings.autoBackupLastAt, libraryLoaded]);
    // A finished session is backed up straight away (counted from when the library loaded).
    const sessionsAtLoadRef = useRef(null);
    useEffect(() => {
        if (!libraryLoaded) return;
        if (sessionsAtLoadRef.current === null) { sessionsAtLoadRef.current = sessionHistory.length; return; }
        if (sessionHistory.length === sessionsAtLoadRef.current) return;
        sessionsAtLoadRef.current = sessionHistory.length;
        if (autoBackup.enabled && backupFolderState === 'granted') runFolderBackupRef.current();
    }, [sessionHistory.length, libraryLoaded, autoBackup.enabled, backupFolderState]);

    const pickBackupFolder = async () => {
        try {
            const handle = await chooseBackupFolder();
            if (!handle) return;
            setBackupFolder(handle);
            setBackupFolderState('granted');
            updateSettings({ autoBackup: { ...autoBackup, enabled: true } });
            addNotification(`Automatic backups will go to "${handle.name}".`, 'success');
        } catch (error) {
            addNotification(error.message || 'Could not use that folder.');
        }
    };
    const allowBackupFolder = async () => {
        const state = await folderPermission(backupFolder, { request: true }).catch(() => 'denied');
        setBackupFolderState(state);
        if (state === 'granted' && autoBackupDue(settings.autoBackupLastAt, autoBackup.everyHours)) runFolderBackupRef.current();
    };
    const stopFolderBackups = async () => {
        await forgetFolder().catch(() => {});
        setBackupFolder(null);
        setBackupFolderState(null);
        updateSettings({ autoBackup: { ...autoBackup, enabled: false } });
    };
    const folderBackupProps = {
        supported: supportsFolderBackup(),
        folderName: backupFolder?.name ?? null,
        folderState: backupFolderState,
        config: autoBackup,
        lastAt: settings.autoBackupLastAt ?? null,
        onChooseFolder: pickBackupFolder,
        onAllow: allowBackupFolder,
        onBackupNow: () => runFolderBackup({ manual: true }),
        onStop: stopFolderBackups,
        onChange: (patch) => updateSettings({ autoBackup: { ...autoBackup, ...patch } })
    };

    const exportBackup = () => {
        downloadBackup(currentBackup());
        setUserStats(prev => markBackedUp(prev));
        addNotification('Backup downloaded.', 'success');
    };

    /** Replaces the whole profile. The Settings panel confirms before calling this. */
    const importBackup = (parsed) => {
        try {
            const restored = readBackup({ ...parsed, settings: migrateAiSettings(parsed?.settings) }, DEFAULT_SETTINGS);
            setSettings(restored.settings);
            // A profile just restored from a file is, by definition, backed up.
            setUserStats(markBackedUp(restored.stats));
            setSessionHistory(restored.history);
            setLibrary(restored.library);
            setDrills(restored.drills);
            setPlans(restored.plans);
            setVocab(restored.vocab);
            setCustomPresets(restored.presets);
            setDrillPacks(restored.drillPacks.map(normalizePack).filter(Boolean));
            setCurrentView('dashboard');
            addNotification(`Restored ${restored.history.length} sessions.`, 'success');
        } catch (error) {
            addNotification(error.message || 'Could not import that backup.');
        }
    };

    const savePlan = (plan) => setPlans(prev => upsertPlan(prev, plan));
    const deletePlan = (id) => {
        setPlans(prev => removePlan(prev, id));
        addNotification('Plan deleted.');
    };

    /**
     * A plan step sends you to the view that runs it. You tick the step off
     * yourself, which keeps plans loosely coupled to everything else.
     */
    const runPlanStep = (step) => {
        const view = STEP_KINDS[step.kind]?.view;
        if (!view) return;
        if (step.kind === 'baseline') {
            startBaseline(0, { fresh: true });
            return;
        }
        navigate(view);
    };

    const deleteSaved = (id) => {
        setLibrary(prev => removeEntry(prev, id));
        addNotification('Removed from library.');
    };

    // Edited text (AI Clean) shifts word numbers, so the saved place and every
    // bookmark are moved to the same words in the new text.
    const updateDocumentText = (id, nextText) => {
        const words = nextText.trim() ? nextText.trim().split(/\s+/).length : 0;
        setLibrary(prev => prev.map(item => {
            if (item.id !== id || isBook(item)) return item;
            const remap = (i) => Math.min(remapWordIndex(item.text, nextText, i), Math.max(0, words - 1));
            return {
                ...item,
                text: nextText,
                words,
                progressIndex: item.progressIndex > 0 ? remap(item.progressIndex) : 0,
                bookmarks: (item.bookmarks ?? []).map(bm => ({ ...bm, index: remap(bm.index) }))
            };
        }));
        addNotification('Document updated.', 'success');
    };

    const updateChapterText = (bookId, chapterIndex, nextText) => {
        const words = nextText.trim() ? nextText.trim().split(/\s+/).length : 0;
        setLibrary(prev => prev.map(item => {
            if (item.id !== bookId || !isBook(item) || !item.chapters[chapterIndex]) return item;
            const old = item.chapters[chapterIndex];
            const remap = (i) => Math.min(remapWordIndex(old.text, nextText, i), Math.max(0, words - 1));
            const chapters = item.chapters.map((ch, idx) => (idx === chapterIndex
                ? { ...ch, text: nextText, words, progressIndex: ch.progressIndex > 0 ? remap(ch.progressIndex) : 0 }
                : ch));
            return {
                ...item,
                chapters,
                words: chapters.reduce((s, c) => s + c.words, 0),
                bookmarks: (item.bookmarks ?? []).map(bm => (bm.chapter === chapterIndex ? { ...bm, index: remap(bm.index) } : bm))
            };
        }));
        addNotification('Chapter updated.', 'success');
    };

    const updateDocumentQuestions = (id, { questions = [], gistQuestions = [] }) => {
        setLibrary(prev => prev.map(item => (item.id === id && !isBook(item)
            ? { ...item, questions, gistQuestions }
            : item)));
        addNotification(`Saved ${questions.length} comprehension question${questions.length === 1 ? '' : 's'}.`, 'success');
    };

    const updateChapterQuestions = (bookId, chapterIndex, { questions = [], gistQuestions = [] }) => {
        setLibrary(prev => prev.map(item => {
            if (item.id !== bookId || !isBook(item) || !item.chapters[chapterIndex]) return item;
            const chapters = item.chapters.map((ch, idx) => (idx === chapterIndex
                ? { ...ch, questions, gistQuestions }
                : ch));
            return { ...item, chapters };
        }));
        addNotification(`Saved ${questions.length} chapter question${questions.length === 1 ? '' : 's'}.`, 'success');
    };

    // "Practise on this chapter": a drill pack from it, selected, and Neuro-Drills opened.
    const practiseChapter = async (book, chapterIndex) => {
        const ch = book.chapters[chapterIndex];
        try {
            const rank = await loadFrequencyRank().catch(() => null);
            const pack = buildDrillPack({ title: `${book.title}: ${ch.title}`, text: ch.text, source: { title: book.title, chapter: ch.title }, rank });
            setDrillPacks(prev => [pack, ...prev].slice(0, 50));
            updateSettings({ drillPackId: pack.id });
            navigate('tools');
            addNotification(`Made a drill pack from "${ch.title}". Chunk Perception and Target Scanning now use it.`, 'success');
        } catch (error) {
            addNotification(error.message || 'Could not make a drill pack from that chapter.');
        }
    };

    // At the end of a book chapter with no quiz, the reader asks for one so the
    // chapter counts as measured training; the questions are kept with the chapter.
    const generateChapterQuiz = ai?.generate ? async (p) => {
        const res = await generateQuestionsFor(ai, { title: p.title, text: p.text }, { verify: settings.verifyQuestions, spread: true });
        if (res.questions.length > 0 && p.bookId && Number.isInteger(p.chapterIndex)) {
            updateChapterQuestions(p.bookId, p.chapterIndex, { questions: res.questions, gistQuestions: res.gistQuestions });
        }
        return res;
    } : null;

    // Leaving part-way through stores the resume point without marking the
    // passage finished.
    const handleReaderLeave = ({ passageId, progressIndex, chapterIndex = null, mode = null }) => {
        if (!passageId) return;
        if (chapterIndex !== null) {
            // Natural mode has no position to save; RSVP, Paced and Skim all
            // resume from the saved word and may rewind it.
            if (mode === 'natural') return;
            setLibrary(prev => recordChapterProgress(prev, passageId, chapterIndex, progressIndex ?? 0, { allowBackward: true }));
            return;
        }
        // Every mode except Natural resumes from the saved word, so save where
        // the reader actually stopped, rewinds and restarts included.
        if (mode === 'natural') return;
        setLibrary(prev => recordProgress(prev, passageId, progressIndex ?? 0, { allowBackward: true }));
    };

    const exitFocus = (to) => {
        if (popoutWin && !popoutWin.closed) popoutWin.close();
        setPopoutWin(null);
        setActivePassage(null);
        setIsRecall(false);
        setCurrentView(to);
    };

    /**
     * `score` is null when no comprehension quiz ran. Those sessions still
     * count as training, but cannot move the target speed or the retention
     * average because nothing about comprehension was measured.
     *
     * Skims are recorded but kept apart: they are checked on gist, so they
     * never move the target, the push intensity, or the peak speed.
     */
    const finishSession = ({ wpm, score, words, elapsedMs, drill = null, mode = null }) => {
        const isBaseline = activePassage?.isCalibration === true;
        const isSkim = !isBaseline && mode === 'skim';
        const session = createSession({
            index: userStats.sessionsCompleted + 1,
            kind: isBaseline ? 'baseline' : isSkim ? 'skim' : 'session',
            mode: drill === 'push' ? 'push' : mode,
            wpm, score, words, elapsedMs
        });

        setSessionHistory(prev => [...prev, session].slice(-HISTORY_LIMIT));

        // The overload phases adapt on the same evidence as the target speed,
        // and behind the same toggle.
        const adaptIntensity = drill === 'push' && session.scored && settings.autoAdaptive;
        const newIntensity = adaptIntensity
            ? nextPushIntensity(userStats.pushIntensity, score)
            : userStats.pushIntensity;

        setUserStats(prev => {
            const today = todayKey();
            const common = {
                ...prev,
                highestWpm: isSkim ? prev.highestWpm : Math.max(prev.highestWpm, wpm),
                sessionsCompleted: prev.sessionsCompleted + 1,
                streak: nextStreak(prev.streak, prev.lastSessionDate, today),
                lastSessionDate: today,
                pushIntensity: newIntensity
            };

            // A baseline read sets the target outright: it is a measurement of
            // how fast you read, averaged over up to three passages.
            if (isBaseline) {
                return addBaselineSample(common, { wpm, score, date: today }, { fresh: activePassage?.baselineFresh !== false });
            }

            return {
                ...common,
                targetWpm: session.scored && !isSkim && settings.autoAdaptive
                    ? adaptTarget(prev.targetWpm, score)
                    : prev.targetWpm
            };
        });

        if (session.scored && !isSkim && !isBaseline && settings.autoAdaptive) {
            setSettings(prev => ({ ...prev, readerWpm: null }));
        }

        const bookChapter = activePassage?.bookId ? activePassage : null;
        if (bookChapter && isSkim) {
            // A skim samples the chapter; it does not finish it.
        } else if (bookChapter) {
            setLibrary(prev => completeChapter(prev, bookChapter.bookId, bookChapter.chapterIndex, { wpm, score }));
        } else if (activePassage?.id && !isBaseline) {
            setLibrary(prev => recordAttempt(prev, activePassage.id, {
                wpm, score, kind: isSkim ? 'skim' : isRecall ? 'recall' : 'read'
            }));
        }

        const book = bookChapter ? findEntry(library, bookChapter.bookId) : null;
        const nextChapterIdx = bookChapter && !isSkim && currentView === 'reader' && book?.chapters[bookChapter.chapterIndex + 1]
            ? bookChapter.chapterIndex + 1
            : -1;

        if (nextChapterIdx >= 0) {
            setActivePassage({ ...chapterPassage(book, nextChapterIdx, 0), autoStart: !session.scored });
            setIsRecall(false);
        } else {
            if (popoutWin && !popoutWin.closed) popoutWin.close();
            setPopoutWin(null);
            setActivePassage(null);
            setIsRecall(false);
            setCurrentView('dashboard');
        }

        if (isBaseline) {
            addNotification(`Baseline reading logged — ${wpm} WPM at ${score}% retention.`, 'success');
        } else if (isSkim) {
            addNotification(session.scored ? `Skim logged — ${wpm} WPM, ${score}% on the check.` : `Skim logged — ${wpm} WPM.`, 'success');
        } else if (bookChapter) {
            const scoreNote = session.scored ? ` at ${score}% retention` : '';
            addNotification(nextChapterIdx < 0
                ? `Book complete — finished at ${wpm} WPM${scoreNote}.`
                : `Chapter done at ${wpm} WPM${scoreNote}. Continuing: ${book.chapters[nextChapterIdx].title}.`, 'success');
        } else {
            addNotification(
                session.scored
                    ? `Session complete — ${wpm} WPM at ${score}% retention.`
                    : `Practice logged — ${wpm} WPM (no quiz, speed not adjusted).`,
                'success'
            );
        }

        if (newIntensity !== userStats.pushIntensity) {
            addNotification(
                `Push overload ${newIntensity > userStats.pushIntensity ? 'raised' : 'eased'} to ${intensityLabel(newIntensity)}.`
            );
        }
    };

    const recallDue = recallQueue(library);
    const vocabDue = dueItems(vocab).length;
    const nextAction = pickNextAction({ stats: userStats, history: sessionHistory, recallDue, plans, library });

    /** Runs whatever the dashboard's "Do this next" card suggests. */
    const runNextAction = (action) => {
        switch (action.kind) {
            case 'baseline': startBaseline(0, { fresh: true }); break;
            case 'baseline-more': startBaseline(action.index, { fresh: false }); break;
            case 'recall': openSaved(action.id, { recall: true }); break;
            case 'plan': runPlanStep(action.step); break;
            case 'book': openBookChapter(action.id, action.chapter); break;
            default: navigate('library');
        }
    };

    const focus = FOCUS_VIEWS.has(currentView);
    const badges = { dashboard: recallDue.length, vocab: vocabDue };
    const activeOpeningWpm = settings.autoAdaptive ? userStats.targetWpm : settings.baseWpm;
    const readerOpeningWpm = settings.readerWpm ?? activeOpeningWpm;
    const activeBook = activePassage?.bookId ? findEntry(library, activePassage.bookId) : null;

    const selectBookChapter = (chapterIndex, { progressIndex = 0, mode = 'rsvp' } = {}) => {
        if (!activeBook || !activeBook.chapters[chapterIndex]) return;
        if (mode !== 'natural' && Number.isInteger(activePassage?.chapterIndex)) {
            setLibrary(prev => recordChapterProgress(prev, activeBook.id, activePassage.chapterIndex, progressIndex, { allowBackward: true }));
        }
        openBookChapter(activeBook.id, chapterIndex, null, returnView);
    };

    return (
        <div className={`h-screen bg-slate-950 text-slate-200 ${settings.font} flex overflow-hidden selection:bg-purple-500/30`}>
            <a href="#main-scroll" className="sr-only focus:not-sr-only focus:absolute focus:z-[70] focus:top-2 focus:left-2 bg-purple-600 text-white px-3 py-2 rounded-lg">
                Skip to content
            </a>
            {!focus && <Sidebar current={currentView} onSelect={navigate} badges={badges} />}

            <main id="main-scroll" className="flex-1 h-screen overflow-y-auto relative" tabIndex={-1}>
                {!focus && <PhoneHeader />}
                <div className={`mx-auto h-full ${focus
                    ? 'max-w-5xl p-3 md:p-6 pb-6'
                    : 'max-w-6xl p-4 md:p-8 lg:p-10 pb-28 md:pb-16'}`}
                >
                    <Suspense fallback={<ViewFallback />}>
                        {currentView === 'dashboard' && (
                            <Dashboard
                                stats={userStats} history={sessionHistory} settings={settings} theme={theme}
                                recallDue={recallDue} nextAction={nextAction} onAction={runNextAction}
                                backupDue={backupReminderDue(userStats)} onBackup={exportBackup}
                                backupPaused={autoBackup.enabled && backupFolderState === 'prompt'} onAllowBackup={allowBackupFolder} backupFolderName={backupFolder?.name}
                                library={library}
                                onContinue={(item) => (item.kind === 'book'
                                    ? openBookChapter(item.id, item.chapterIndex, null, 'dashboard')
                                    : openSaved(item.id, { returnTo: 'dashboard' }))}
                                onSnoozeBackup={() => setUserStats(prev => snoozeBackup(prev))}
                                onRecall={(id) => openSaved(id, { recall: true })}
                                onStart={() => navigate('library')}
                            />
                        )}
                        {currentView === 'library' && <Library onPractiseChapter={practiseChapter} library={library} ai={ai} verifyQuestions={settings.verifyQuestions} readingWpm={activeOpeningWpm} onStartPassage={startPassage} onStartPushDrill={startPushDrill} onOpenSaved={openSaved} onDeleteSaved={deleteSaved} onOpenChapter={openBookChapter} onRemoveBookmark={(bookId, bookmarkId) => setLibrary(prev => removeBookmark(prev, bookId, bookmarkId))} addNotification={addNotification} />}
                        {currentView === 'documents' && <Documents onPractiseChapter={practiseChapter} onSaveBook={saveBook} freeBooksRequest={freeBooksRequest} ai={ai} verifyQuestions={settings.verifyQuestions} library={library} readingWpm={readerOpeningWpm} onOpenSaved={(id, opts) => openSaved(id, { ...opts, returnTo: 'documents' })} onDeleteSaved={deleteSaved} onUpdateDocumentText={updateDocumentText} onUpdateChapterText={updateChapterText} onUpdateDocumentQuestions={updateDocumentQuestions} onUpdateChapterQuestions={updateChapterQuestions} onOpenChapter={openBookChapter} onRemoveBookmark={(bookId, bookmarkId) => setLibrary(prev => removeBookmark(prev, bookId, bookmarkId))} onRemovePassageBookmark={(id, bmId) => setLibrary(prev => removePassageBookmark(prev, id, bmId))} onOpenUpload={() => navigate('upload')} addNotification={addNotification} />}
                        {currentView === 'upload' && <Upload ai={ai} library={library} readingWpm={readerOpeningWpm} onStartPassage={startPassage} onStartPushDrill={startPushDrill} onSaveBook={saveBook} onSavePassage={(p) => saveToLibrary(p, 'import')} onOpenSaved={(id) => openSaved(id, { returnTo: 'documents' })} onDeleteSaved={deleteSaved} onOpenDocuments={() => navigate('documents')} onOpenFreeBooks={() => { setFreeBooksRequest(n => n + 1); navigate('documents'); }} addNotification={addNotification} />}
                        {currentView === 'recall' && <RecallCheck passage={activePassage} onDone={finishRecall} onExit={() => exitFocus('dashboard')} />}
                        {currentView === 'push' && <SpeedPush reading={reading} patchReading={patchReading} updateSettings={updateSettings} passage={activePassage} targetWpm={activeOpeningWpm} intensity={userStats.pushIntensity} settings={settings} onFinish={finishSession} onExit={() => exitFocus(returnView)} />}
                        {currentView === 'reader' && <Reader key={activePassage?.id + ':' + (activePassage?.chapterIndex ?? '')} passage={activePassage} book={activeBook} onSelectChapter={activeBook ? selectBookChapter : null} settings={settings} reading={reading} patchReading={patchReading} updateSettings={updateSettings} customPresets={customPresets} onSavePresets={setCustomPresets} popoutWin={popoutWin} onPopoutChange={setPopoutWin} initialWpm={readerOpeningWpm} resumeFrom={activePassage?.resumeFrom ?? (isRecall ? 0 : resumePoint(findEntry(library, activePassage?.id)))} onFinish={finishSession} onLeave={handleReaderLeave} onBookmark={!activePassage?.isCalibration ? bookmarkHere : null} onGenerateQuiz={generateChapterQuiz} onExit={() => exitFocus(activePassage?.isCalibration ? 'dashboard' : returnView)} addNotification={addNotification} />}
                        {currentView === 'tools' && (
                            <Tools
                                drills={drills} adaptiveStart={settings.autoAdaptive} onDrillComplete={handleDrillComplete} addNotification={addNotification}
                                packs={drillPacks} library={library}
                                activePackId={settings.drillPackId ?? null} onSelectPack={(id) => updateSettings({ drillPackId: id })}
                                ai={ai}
                                onSavePack={(pack, { updateOnly = false } = {}) => {
                                    const clean = normalizePack(pack);
                                    if (!clean) return;
                                    setDrillPacks(prev => (updateOnly && !prev.some(p => p.id === clean.id)
                                        ? prev
                                        : [clean, ...prev.filter(p => p.id !== clean.id)].slice(0, 50)));
                                }}
                                onDeletePack={(id) => {
                                    setDrillPacks(prev => prev.filter(p => p.id !== id));
                                    if (settings.drillPackId === id) updateSettings({ drillPackId: null });
                                }}
                            />
                        )}
                        {currentView === 'vocab' && <Vocabulary vocab={vocab} setVocab={setVocab} library={library} ai={ai} addNotification={addNotification} />}
                        {currentView === 'analytics' && <Analytics history={sessionHistory} drills={drills} stats={userStats} theme={theme} />}
                        {currentView === 'settings' && <SettingsPanel settings={settings} updateSettings={updateSettings} apiKeyPresent={apiKeyPresent} ai={ai} localAi={localAi} onRecheckLocalAi={recheckLocalAi} hasBaseline={userStats.baselineWpm !== null} baselineSamples={userStats.baselineSamples} lastBackupAt={userStats.lastBackupAt} folderBackup={folderBackupProps} adaptiveTargetWpm={userStats.targetWpm} pushIntensity={userStats.pushIntensity} onExport={exportBackup} onImport={importBackup} onRecalibrate={() => startBaseline(0, { fresh: true })} onAddBaseline={() => startBaseline(userStats.baselineSamples.length, { fresh: false })} />}
                        {currentView === 'coach' && <AICoach stats={userStats} history={sessionHistory} ai={ai} addNotification={addNotification} />}
                        {currentView === 'youtube' && <VideoSummary ai={ai} onStartPassage={startPassage} addNotification={addNotification} />}
                        {currentView === 'plans' && <Plans plans={plans} onSavePlan={savePlan} onDeletePlan={deletePlan} onRunStep={runPlanStep} addNotification={addNotification} />}
                        {currentView === 'reading' && <ReadingEnvironment reading={reading} patchReading={patchReading} settings={settings} updateSettings={updateSettings} customPresets={customPresets} onSavePresets={setCustomPresets} />}
                        {currentView === 'guide' && <Guide />}
                    </Suspense>
                </div>
            </main>

            {!focus && <PhoneTabBar current={currentView} onSelect={navigate} badges={badges} />}
            <Toasts items={notifications} onDismiss={dismissNotification} />
            {sharedPack && (
                <SharedPackPrompt
                    pack={sharedPack}
                    onDismiss={() => setSharedPack(null)}
                    onAdd={() => {
                        // A pack with the same id already here is kept; the shared copy gets its own id.
                        const pack = drillPacks.some(p => p.id === sharedPack.id) ? { ...sharedPack, id: newPackId() } : sharedPack;
                        setDrillPacks(prev => [pack, ...prev].slice(0, 50));
                        updateSettings({ drillPackId: pack.id });
                        setSharedPack(null);
                        navigate('tools');
                        addNotification(`Added "${pack.title}" to your drills.`, 'success');
                    }}
                />
            )}
        </div>
    );
}
