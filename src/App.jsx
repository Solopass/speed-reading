import { useCallback, useEffect, useState } from 'react';
import {
    Activity, BarChart2, BookOpen, Brain, Info, Map, Settings, Target, Type, Youtube, Zap
} from 'lucide-react';
import { hasApiKey } from './lib/gemini';
import { listModels } from './lib/ollama';
import { DEFAULT_AI_SETTINGS, migrateAiSettings, resolveAi } from './lib/aiProvider';
import {
    DEFAULT_STATS, adaptTarget, clampWpm, createSession, migrateHistory, migrateStats,
    nextStreak, todayKey
} from './lib/stats';
import { CALIBRATION_PASSAGE } from './lib/calibration';
import { intensityLabel, nextPushIntensity } from './lib/protocol';
import { migrateDrills } from './lib/drillStats';
import { createBackup, downloadBackup, readBackup } from './lib/backup';
import { DEFAULT_READING, normalizeReading } from './lib/readingStyle';
import { STEP_KINDS, migratePlans, removePlan, upsertPlan } from './lib/plans';
import {
    createEntry, findEntry, migrateLibrary, recallQueue, recordAttempt,
    recordProgress, removeEntry, resumePoint, toPassage, upsertEntry
} from './lib/library';
import NavItem from './components/NavItem';
import Dashboard from './views/Dashboard';
import Library from './views/Library';
import Reader from './views/Reader';
import RecallCheck from './views/RecallCheck';
import SpeedPush from './components/SpeedPush';
import Tools from './views/Tools';
import Analytics from './views/Analytics';
import SettingsPanel from './views/SettingsPanel';
import AICoach from './views/AICoach';
import YouTubeSync from './views/VideoSummary';
import Guide from './views/Guide';
import ReadingEnvironment from './views/ReadingEnvironment';
import Plans from './views/Plans';

const DEFAULT_SETTINGS = {
    reading: DEFAULT_READING,
    goalWpm: 2000,
    ...DEFAULT_AI_SETTINGS,
    verifyQuestions: true,
    baseWpm: 300,
    chunkSize: 1,
    font: 'font-sans',
    theme: 'dark',
    autoAdaptive: true,
    punctuationPacing: true,
    bionicReading: false,
    rpgLeveling: true,
    audioSyncEnabled: false
};

export default function App() {
    const [currentView, setCurrentView] = useState('dashboard');

    const [settings, setSettings] = useState(() => {
        try {
            const saved = localStorage.getItem('speedReadSettings');
            // Merged over the defaults, not substituted for them: a setting
            // added in a later build would otherwise be undefined for anyone
            // who already has saved settings.
            return { ...DEFAULT_SETTINGS, ...(saved ? migrateAiSettings(JSON.parse(saved)) : {}) };
        } catch { return { ...DEFAULT_SETTINGS }; }
    });

    const [userStats, setUserStats] = useState(() => {
        try {
            const saved = localStorage.getItem('speedReadStats');
            return migrateStats(saved ? JSON.parse(saved) : null);
        } catch { return { ...DEFAULT_STATS }; }
    });

    const [sessionHistory, setSessionHistory] = useState(() => {
        try {
            const saved = localStorage.getItem('speedReadHistory');
            return migrateHistory(saved ? JSON.parse(saved) : []);
        } catch { return []; }
    });

    const [library, setLibrary] = useState(() => {
        try {
            const saved = localStorage.getItem('speedReadLibrary');
            return migrateLibrary(saved ? JSON.parse(saved) : []);
        } catch { return []; }
    });

    const [plans, setPlans] = useState(() => {
        try {
            const saved = localStorage.getItem('speedReadPlans');
            return migratePlans(saved ? JSON.parse(saved) : []);
        } catch { return []; }
    });

    const [drills, setDrills] = useState(() => {
        try {
            const saved = localStorage.getItem('speedReadDrills');
            return migrateDrills(saved ? JSON.parse(saved) : []);
        } catch { return []; }
    });

    const [activePassage, setActivePassage] = useState(null);
    // Set when a passage is opened purely to re-test retention, so the result
    // is recorded against the spaced schedule rather than as a fresh read.
    const [isRecall, setIsRecall] = useState(false);
    const [notifications, setNotifications] = useState([]);

    useEffect(() => {
        localStorage.setItem('speedReadSettings', JSON.stringify(settings));
        localStorage.setItem('speedReadStats', JSON.stringify(userStats));
        localStorage.setItem('speedReadHistory', JSON.stringify(sessionHistory));
        localStorage.setItem('speedReadLibrary', JSON.stringify(library));
        localStorage.setItem('speedReadDrills', JSON.stringify(drills));
        localStorage.setItem('speedReadPlans', JSON.stringify(plans));
    }, [settings, userStats, sessionHistory, library, drills, plans]);

    const addNotification = useCallback((msg) => {
        const id = Date.now();
        setNotifications(prev => [...prev, { id, msg }]);
        setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 3000);
    }, []);

    const updateSettings = (newSettings) => setSettings(prev => ({ ...prev, ...newSettings }));

    // Always read through the normalizer, so a stored or imported value that is
    // out of range degrades to something usable rather than blanking the page.
    const reading = normalizeReading(settings.reading);
    const updateReading = (next) => updateSettings({ reading: normalizeReading(next) });

    // Live state of the local Ollama server. Checked when the local provider is
    // selected or its address changes, and again on demand from Settings.
    const [localAi, setLocalAi] = useState({ status: 'checking', models: [] });
    const [localCheck, setLocalCheck] = useState(0);
    const recheckLocalAi = useCallback(() => setLocalCheck(n => n + 1), []);

    useEffect(() => {
        if (settings.aiProvider !== 'local') return undefined;
        const controller = new AbortController();
        setLocalAi(prev => ({ ...prev, status: 'checking' }));
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
     * re-quizzed days later. Without this the library was a generator, not a
     * library — passages vanished the moment you finished them.
     */
    const saveToLibrary = (passageData, source, kind = 'read') => {
        const entry = createEntry({ ...passageData, source, kind });
        setLibrary(prev => upsertEntry(prev, entry));
        return entry;
    };

    const startPassage = (passageData, { source = 'import', save = true, recall = false } = {}) => {
        const entry = save ? saveToLibrary(passageData, source) : null;
        setActivePassage({ ...passageData, id: entry?.id ?? passageData.id });
        setIsRecall(recall);
        setCurrentView('reader');
    };

    const startPushDrill = (drillPassage, { source = 'builtin', save = true } = {}) => {
        const entry = save ? saveToLibrary(drillPassage, source, 'push') : null;
        setActivePassage({ ...drillPassage, id: entry?.id ?? drillPassage.id });
        setIsRecall(false);
        setCurrentView('push');
    };

    /**
     * Reopens a stored passage. A retention re-test goes straight to the
     * questions — re-reading first would measure nothing, since the whole point
     * is whether the passage stayed with you.
     */
    const openSaved = (id, { recall = false } = {}) => {
        const entry = findEntry(library, id);
        if (!entry) return;
        setActivePassage(toPassage(entry));
        setIsRecall(recall);
        if (recall) setCurrentView('recall');
        else setCurrentView(entry.kind === 'push' ? 'push' : 'reader');
    };

    /**
     * Retention checks record against the passage but never enter session
     * history: no reading happened, so there is no speed to pair the score with
     * and no effective WPM to compute.
     */
    const finishRecall = (score) => {
        setLibrary(prev => recordAttempt(prev, activePassage.id, { wpm: null, score, kind: 'recall' }));
        setActivePassage(null);
        setIsRecall(false);
        setCurrentView('dashboard');
        addNotification(`Retention check: ${score}% recalled.`);
    };

    // Drill results are their own history: they measure visual span and search
    // speed, not reading, so they never touch session stats or the target WPM.
    const handleDrillComplete = (result) => {
        setDrills(prev => [...prev, result].slice(-100));
        addNotification(result.kind === 'peripheral'
            ? `Span threshold: ${result.metric}ms.`
            : `Found in ${result.metric}s.`);
    };

    const exportBackup = () => {
        downloadBackup(createBackup({ settings, stats: userStats, history: sessionHistory, library, drills, plans }));
        addNotification('Backup downloaded.');
    };

    /** Replaces the whole profile. The Settings panel confirms before calling this. */
    const importBackup = (parsed) => {
        try {
            const restored = readBackup({ ...parsed, settings: migrateAiSettings(parsed?.settings) }, DEFAULT_SETTINGS);
            setSettings(restored.settings);
            setUserStats(restored.stats);
            setSessionHistory(restored.history);
            setLibrary(restored.library);
            setDrills(restored.drills);
            setPlans(restored.plans);
            setCurrentView('dashboard');
            addNotification(`Restored ${restored.history.length} sessions.`);
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
     * A plan step sends you to the view that runs it. The plan does not try to
     * drive the app any further than that — you tick the step off yourself,
     * which keeps plans loosely coupled to everything else.
     */
    const runPlanStep = (step) => {
        const view = STEP_KINDS[step.kind]?.view;
        if (!view) return;
        if (step.kind === 'baseline') {
            startPassage(CALIBRATION_PASSAGE, { save: false });
            return;
        }
        setCurrentView(view);
    };

    const deleteSaved = (id) => {
        setLibrary(prev => removeEntry(prev, id));
        addNotification('Removed from library.');
    };

    // Leaving part-way through stores the resume point without marking the
    // passage finished.
    const handleReaderLeave = ({ passageId, progressIndex }) => {
        if (!passageId || !progressIndex) return;
        setLibrary(prev => recordProgress(prev, passageId, progressIndex));
    };

    /**
     * `score` is null when no comprehension quiz ran (custom text, or an AI
     * passage that came back without questions). Those sessions still count as
     * training, but they cannot move the target speed or the retention average
     * because nothing about comprehension was actually measured.
     */
    const finishSession = ({ wpm, score, words, elapsedMs, drill = null }) => {
        const isBaseline = activePassage?.isCalibration === true;
        const session = createSession({
            index: sessionHistory.length + 1,
            kind: isBaseline ? 'baseline' : 'session',
            wpm, score, words, elapsedMs
        });

        setSessionHistory(prev => [...prev, session].slice(-50));

        // The overload phases adapt on the same evidence as the target speed,
        // and behind the same toggle: one switch decides whether the app tunes
        // the difficulty or leaves it exactly where you set it.
        const adaptIntensity = drill === 'push' && session.scored && settings.autoAdaptive;
        const newIntensity = adaptIntensity
            ? nextPushIntensity(userStats.pushIntensity, score)
            : userStats.pushIntensity;

        setUserStats(prev => {
            const today = todayKey();
            const common = {
                ...prev,
                highestWpm: Math.max(prev.highestWpm, wpm),
                sessionsCompleted: prev.sessionsCompleted + 1,
                streak: nextStreak(prev.streak, prev.lastSessionDate, today),
                lastSessionDate: today,
                pushIntensity: newIntensity
            };

            // The baseline replaces the placeholder target outright rather than
            // nudging it — it is the first real measurement of how fast you read.
            if (isBaseline) {
                return {
                    ...common,
                    baselineWpm: clampWpm(wpm),
                    baselineComprehension: score,
                    baselineDate: today,
                    targetWpm: clampWpm(wpm)
                };
            }

            return {
                ...common,
                targetWpm: session.scored && settings.autoAdaptive
                    ? adaptTarget(prev.targetWpm, score)
                    : prev.targetWpm
            };
        });

        if (activePassage?.id) {
            setLibrary(prev => recordAttempt(prev, activePassage.id, {
                wpm, score, kind: isRecall ? 'recall' : 'read'
            }));
        }

        setActivePassage(null);
        setIsRecall(false);
        setCurrentView('dashboard');

        if (isBaseline) {
            addNotification(`Baseline set — ${wpm} WPM at ${score}% retention.`);
        } else {
            addNotification(
                session.scored
                    ? `Session complete — ${wpm} WPM at ${score}% retention.`
                    : `Practice logged — ${wpm} WPM (no quiz, speed not adjusted).`
            );
        }

        if (newIntensity !== userStats.pushIntensity) {
            addNotification(
                `Push overload ${newIntensity > userStats.pushIntensity ? 'raised' : 'eased'} to ${intensityLabel(newIntensity)}.`
            );
        }
    };

    return (
        <div className={`min-h-screen bg-slate-950 text-slate-200 ${settings.font} flex overflow-hidden selection:bg-purple-500/30`}>
            <aside className="w-20 md:w-64 border-r border-slate-800 bg-slate-900/50 flex flex-col items-center md:items-start shrink-0">
                <div className="h-20 w-full flex items-center justify-center md:justify-start md:px-6 border-b border-slate-800">
                    <Zap className="text-purple-500 w-8 h-8" />
                    <span className="ml-3 font-bold text-xl hidden md:block text-white tracking-tight">Speed AI</span>
                </div>
                <nav className="flex-1 w-full py-6 flex flex-col gap-2 px-2 md:px-4 overflow-y-auto">
                    <NavItem icon={<Activity />} label="Dashboard" active={currentView === 'dashboard'} onClick={() => setCurrentView('dashboard')} />
                    <NavItem icon={<BookOpen />} label="Library" active={currentView === 'library'} onClick={() => setCurrentView('library')} />
                    <NavItem icon={<Brain />} label="Neuro-Drills" active={currentView === 'tools'} onClick={() => setCurrentView('tools')} />
                    <NavItem icon={<Map />} label="Plans" active={currentView === 'plans'} onClick={() => setCurrentView('plans')} />
                    <NavItem icon={<Type />} label="Reading Setup" active={currentView === 'reading'} onClick={() => setCurrentView('reading')} />
                    <NavItem icon={<Youtube />} label="Video Summary" active={currentView === 'youtube'} onClick={() => setCurrentView('youtube')} />
                    <NavItem icon={<BarChart2 />} label="Analytics" active={currentView === 'analytics'} onClick={() => setCurrentView('analytics')} />
                    <NavItem icon={<Target />} label="AI Coach" active={currentView === 'coach'} onClick={() => setCurrentView('coach')} />
                </nav>
                <div className="w-full p-2 md:p-4 border-t border-slate-800 flex flex-col gap-2">
                    <NavItem icon={<Info />} label="Guide" active={currentView === 'guide'} onClick={() => setCurrentView('guide')} />
                    <NavItem icon={<Settings />} label="Settings" active={currentView === 'settings'} onClick={() => setCurrentView('settings')} />
                </div>
            </aside>

            <main className="flex-1 h-screen overflow-y-auto relative">
                <div className="p-6 md:p-10 max-w-7xl mx-auto h-full pb-32">
                    {currentView === 'dashboard' && <Dashboard stats={userStats} history={sessionHistory} settings={settings} recallDue={recallQueue(library)} onStart={() => setCurrentView('library')} onCalibrate={() => startPassage(CALIBRATION_PASSAGE, { save: false })} onRecall={(id) => openSaved(id, { recall: true })} />}
                    {currentView === 'library' && <Library library={library} ai={ai} verifyQuestions={settings.verifyQuestions} onStartPassage={startPassage} onStartPushDrill={startPushDrill} onOpenSaved={openSaved} onDeleteSaved={deleteSaved} addNotification={addNotification} />}
                    {currentView === 'recall' && <RecallCheck passage={activePassage} onDone={finishRecall} onExit={() => { setActivePassage(null); setIsRecall(false); setCurrentView('dashboard'); }} />}
                    {currentView === 'push' && <SpeedPush reading={reading} passage={activePassage} targetWpm={settings.autoAdaptive ? userStats.targetWpm : settings.baseWpm} intensity={userStats.pushIntensity} settings={settings} onFinish={finishSession} onExit={() => { setActivePassage(null); setCurrentView('library'); }} />}
                    {currentView === 'reader' && <Reader passage={activePassage} settings={settings} reading={reading} initialWpm={settings.autoAdaptive ? userStats.targetWpm : settings.baseWpm} resumeFrom={isRecall ? 0 : resumePoint(findEntry(library, activePassage?.id))} onFinish={finishSession} onLeave={handleReaderLeave} onExit={() => { setActivePassage(null); setCurrentView('library'); }} addNotification={addNotification} />}
                    {currentView === 'tools' && <Tools drills={drills} adaptiveStart={settings.autoAdaptive} onDrillComplete={handleDrillComplete} addNotification={addNotification} />}
                    {currentView === 'analytics' && <Analytics history={sessionHistory} />}
                    {currentView === 'settings' && <SettingsPanel settings={settings} updateSettings={updateSettings} apiKeyPresent={apiKeyPresent} ai={ai} localAi={localAi} onRecheckLocalAi={recheckLocalAi} hasBaseline={userStats.baselineWpm !== null} adaptiveTargetWpm={userStats.targetWpm} pushIntensity={userStats.pushIntensity} onExport={exportBackup} onImport={importBackup} onRecalibrate={() => startPassage(CALIBRATION_PASSAGE, { save: false })} />}
                    {currentView === 'coach' && <AICoach stats={userStats} history={sessionHistory} ai={ai} addNotification={addNotification} />}
                    {currentView === 'youtube' && <YouTubeSync ai={ai} onStartPassage={startPassage} addNotification={addNotification} />}
                    {currentView === 'plans' && <Plans plans={plans} onSavePlan={savePlan} onDeletePlan={deletePlan} onRunStep={runPlanStep} addNotification={addNotification} />}
                    {currentView === 'reading' && <ReadingEnvironment reading={reading} updateReading={updateReading} />}
                    {currentView === 'guide' && <Guide />}
                </div>

                <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
                    {notifications.map(note => (
                        <div key={note.id} className="bg-purple-600 text-white px-6 py-3 rounded-xl shadow-lg shadow-purple-900/20 font-medium animate-in slide-in-from-right-8 pointer-events-auto flex items-center gap-2">
                            <Info size={16} /> {note.msg}
                        </div>
                    ))}
                </div>
            </main>
        </div>
    );
}
