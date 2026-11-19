import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { hasApiKey } from './lib/gemini';
import { listModels } from './lib/ollama';
import { DEFAULT_AI_SETTINGS, migrateAiSettings, resolveAi } from './lib/aiProvider';
import {
    DEFAULT_STATS, HISTORY_LIMIT, addBaselineSample, adaptTarget, backupReminderDue, createSession,
    markBackedUp, migrateHistory, migrateStats, nextStreak, snoozeBackup, todayKey
} from './lib/stats';
import { CALIBRATION_PASSAGES } from './lib/calibration';
import { intensityLabel, nextPushIntensity } from './lib/protocol';
import { MAX_DRILL_HISTORY, migrateDrills } from './lib/drillStats';
import { createBackup, downloadBackup, readBackup } from './lib/backup';
import { DEFAULT_READING, normalizeReading } from './lib/readingStyle';
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

const DEFAULT_SETTINGS = {
    reading: DEFAULT_READING,
    goalWpm: 2000,
    ...DEFAULT_AI_SETTINGS,
    verifyQuestions: true,
    baseWpm: 300,
    readerWpm: null,
    skimWpm: null,
    chunkSize: 1,
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

    useEffect(() => {
        let cancelled = false;
        loadLibraryIdb().then((stored) => {
            if (cancelled) return;
            libraryReadyRef.current = true;
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
        saveLibraryIdb(library);
        try {
            const json = JSON.stringify(library);
            if (json.length * 2 < 3_000_000) localStorage.setItem('speedReadLibrary', json);
            else localStorage.removeItem('speedReadLibrary');
        } catch {
            // IndexedDB is the primary store; ignore localStorage quota overflow.
        }
    }, [library]);
    const [plans, setPlans] = usePersistentState('speedReadPlans', (raw) => migratePlans(raw ?? []), [], onSaveError);
    const [drills, setDrills] = usePersistentState('speedReadDrills', (raw) => migrateDrills(raw ?? []), [], onSaveError);
    const [vocab, setVocab] = usePersistentState('speedReadVocab', migrateVocab, [], onSaveError);

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
    const updateReading = (next) => updateSettings({ reading: normalizeReading(next) });
    // Merges into the latest stored value, so several quick changes (the
    // reader's settings drawer) cannot overwrite one another.
    const patchReading = (patch) => setSettings(prev => ({ ...prev, reading: normalizeReading({ ...prev.reading, ...patch }) }));

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
        setLibrary(prev => upsertEntry(prev, book));
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
        addNotification(result.kind === 'peripheral'
            ? `Span threshold: ${result.metric}ms.`
            : `Found in ${result.metric}s.`, 'success');
    };

    const exportBackup = () => {
        downloadBackup(createBackup({ settings, stats: userStats, history: sessionHistory, library, drills, plans, vocab }));
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
        if (!progressIndex) return;
        setLibrary(prev => recordProgress(prev, passageId, progressIndex));
    };

    const exitFocus = (to) => {
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
            setLibrary(prev => completeChapter(prev, bookChapter.bookId, bookChapter.chapterIndex, { wpm }));
        } else if (activePassage?.id && !isBaseline) {
            setLibrary(prev => recordAttempt(prev, activePassage.id, {
                wpm, score, kind: isSkim ? 'skim' : isRecall ? 'recall' : 'read'
            }));
        }

        setActivePassage(null);
        setIsRecall(false);
        setCurrentView('dashboard');

        if (isBaseline) {
            addNotification(`Baseline reading logged — ${wpm} WPM at ${score}% retention.`, 'success');
        } else if (isSkim) {
            addNotification(session.scored ? `Skim logged — ${wpm} WPM, ${score}% on the check.` : `Skim logged — ${wpm} WPM.`, 'success');
        } else if (bookChapter) {
            const book = findEntry(library, bookChapter.bookId);
            const next = book?.chapters.findIndex((c, i) => i > bookChapter.chapterIndex && !c.completedAt) ?? -1;
            addNotification(next === -1
                ? `Chapter done at ${wpm} WPM.`
                : `Chapter done at ${wpm} WPM. Next: ${book.chapters[next].title}.`, 'success');
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
                                onSnoozeBackup={() => setUserStats(prev => snoozeBackup(prev))}
                                onRecall={(id) => openSaved(id, { recall: true })}
                                onStart={() => navigate('library')}
                            />
                        )}
                        {currentView === 'library' && <Library library={library} ai={ai} verifyQuestions={settings.verifyQuestions} readingWpm={activeOpeningWpm} onStartPassage={startPassage} onStartPushDrill={startPushDrill} onOpenSaved={openSaved} onDeleteSaved={deleteSaved} onOpenChapter={openBookChapter} onRemoveBookmark={(bookId, bookmarkId) => setLibrary(prev => removeBookmark(prev, bookId, bookmarkId))} addNotification={addNotification} />}
                        {currentView === 'documents' && <Documents library={library} readingWpm={readerOpeningWpm} onOpenSaved={(id, opts) => openSaved(id, { ...opts, returnTo: 'documents' })} onDeleteSaved={deleteSaved} onOpenChapter={openBookChapter} onRemoveBookmark={(bookId, bookmarkId) => setLibrary(prev => removeBookmark(prev, bookId, bookmarkId))} onRemovePassageBookmark={(id, bmId) => setLibrary(prev => removePassageBookmark(prev, id, bmId))} onOpenUpload={() => navigate('upload')} />}
                        {currentView === 'upload' && <Upload library={library} readingWpm={readerOpeningWpm} onStartPassage={startPassage} onStartPushDrill={startPushDrill} onSaveBook={saveBook} onSavePassage={(p) => saveToLibrary(p, 'import')} onOpenSaved={(id) => openSaved(id, { returnTo: 'documents' })} onDeleteSaved={deleteSaved} onOpenDocuments={() => navigate('documents')} addNotification={addNotification} />}
                        {currentView === 'recall' && <RecallCheck passage={activePassage} onDone={finishRecall} onExit={() => exitFocus('dashboard')} />}
                        {currentView === 'push' && <SpeedPush reading={reading} patchReading={patchReading} updateSettings={updateSettings} passage={activePassage} targetWpm={activeOpeningWpm} intensity={userStats.pushIntensity} settings={settings} onFinish={finishSession} onExit={() => exitFocus(returnView)} />}
                        {currentView === 'reader' && <Reader key={activePassage?.id + ':' + (activePassage?.chapterIndex ?? '')} passage={activePassage} book={activeBook} onSelectChapter={activeBook ? selectBookChapter : null} settings={settings} reading={reading} patchReading={patchReading} updateSettings={updateSettings} initialWpm={readerOpeningWpm} resumeFrom={activePassage?.resumeFrom ?? (isRecall ? 0 : resumePoint(findEntry(library, activePassage?.id)))} onFinish={finishSession} onLeave={handleReaderLeave} onBookmark={!activePassage?.isCalibration ? bookmarkHere : null} onExit={() => exitFocus(activePassage?.isCalibration ? 'dashboard' : returnView)} addNotification={addNotification} />}
                        {currentView === 'tools' && <Tools drills={drills} adaptiveStart={settings.autoAdaptive} onDrillComplete={handleDrillComplete} addNotification={addNotification} />}
                        {currentView === 'vocab' && <Vocabulary vocab={vocab} setVocab={setVocab} library={library} ai={ai} addNotification={addNotification} />}
                        {currentView === 'analytics' && <Analytics history={sessionHistory} drills={drills} stats={userStats} theme={theme} />}
                        {currentView === 'settings' && <SettingsPanel settings={settings} updateSettings={updateSettings} apiKeyPresent={apiKeyPresent} ai={ai} localAi={localAi} onRecheckLocalAi={recheckLocalAi} hasBaseline={userStats.baselineWpm !== null} baselineSamples={userStats.baselineSamples} lastBackupAt={userStats.lastBackupAt} adaptiveTargetWpm={userStats.targetWpm} pushIntensity={userStats.pushIntensity} onExport={exportBackup} onImport={importBackup} onRecalibrate={() => startBaseline(0, { fresh: true })} onAddBaseline={() => startBaseline(userStats.baselineSamples.length, { fresh: false })} />}
                        {currentView === 'coach' && <AICoach stats={userStats} history={sessionHistory} ai={ai} addNotification={addNotification} />}
                        {currentView === 'youtube' && <VideoSummary ai={ai} onStartPassage={startPassage} addNotification={addNotification} />}
                        {currentView === 'plans' && <Plans plans={plans} onSavePlan={savePlan} onDeletePlan={deletePlan} onRunStep={runPlanStep} addNotification={addNotification} />}
                        {currentView === 'reading' && <ReadingEnvironment reading={reading} updateReading={updateReading} />}
                        {currentView === 'guide' && <Guide />}
                    </Suspense>
                </div>
            </main>

            {!focus && <PhoneTabBar current={currentView} onSelect={navigate} badges={badges} />}
            <Toasts items={notifications} onDismiss={dismissNotification} />
        </div>
    );
}
