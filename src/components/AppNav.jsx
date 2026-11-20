import { useEffect, useState } from 'react';
import {
    Activity, BarChart2, BookOpen, Brain, FileText, Info, LayoutGrid, Map, Settings, Target, Type, SpellCheck, Upload, X, Youtube, Zap
} from 'lucide-react';

// One list drives the sidebar, the phone tab bar and its "More" sheet, so
// the three can never disagree about what exists.
export const NAV_GROUPS = [
    {
        label: 'Train',
        items: [
            { id: 'dashboard', label: 'Dashboard', icon: Activity },
            { id: 'library', label: 'Library', icon: BookOpen },
            { id: 'documents', label: 'Documents', icon: FileText },
            { id: 'upload', label: 'Upload', icon: Upload },
            { id: 'tools', label: 'Neuro-Drills', icon: Brain },
            { id: 'vocab', label: 'Vocabulary', icon: SpellCheck },
            { id: 'plans', label: 'Plans', icon: Map }
        ]
    },
    {
        label: 'Progress',
        items: [
            { id: 'analytics', label: 'Analytics', icon: BarChart2 },
            { id: 'coach', label: 'AI Coach', icon: Target }
        ]
    },
    {
        label: 'Sources & setup',
        items: [
            { id: 'youtube', label: 'Video Summary', icon: Youtube },
            { id: 'reading', label: 'Reading Setup', icon: Type }
        ]
    }
];

export const FOOTER_ITEMS = [
    { id: 'guide', label: 'Guide', icon: Info },
    { id: 'settings', label: 'Settings', icon: Settings }
];

/** The four destinations that get their own tab on a phone; the rest live under More. */
const PHONE_TABS = ['dashboard', 'library', 'tools', 'analytics'];

const ALL_ITEMS = [...NAV_GROUPS.flatMap(g => g.items), ...FOOTER_ITEMS];

function SideItem({ item, active, onSelect, badge }) {
    const Icon = item.icon;
    return (
        <button
            onClick={() => onSelect(item.id)}
            aria-current={active ? 'page' : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                active ? 'bg-purple-500/10 text-purple-400' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }`}
        >
            <Icon size={18} className="shrink-0" />
            <span className="flex-1 text-left truncate">{item.label}</span>
            {badge > 0 && (
                <span className="text-[10px] font-bold bg-purple-600 text-white rounded-full min-w-5 h-5 px-1.5 grid place-items-center">{badge}</span>
            )}
        </button>
    );
}

/** Desktop and tablet sidebar, grouped. Hidden below md, where the tab bar takes over. */
export function Sidebar({ current, onSelect, badges = {} }) {
    return (
        <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900/50">
            <div className="h-16 flex items-center gap-2.5 px-5 border-b border-slate-800">
                <div className="w-8 h-8 rounded-lg bg-purple-600 grid place-items-center text-white"><Zap size={18} /></div>
                <span className="font-bold text-lg text-white tracking-tight">Speed AI</span>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Main">
                {NAV_GROUPS.map(group => (
                    <div key={group.label}>
                        <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">{group.label}</div>
                        <div className="space-y-0.5">
                            {group.items.map(item => (
                                <SideItem key={item.id} item={item} active={current === item.id} onSelect={onSelect} badge={badges[item.id]} />
                            ))}
                        </div>
                    </div>
                ))}
            </nav>
            <div className="px-3 py-3 border-t border-slate-800 space-y-0.5">
                {FOOTER_ITEMS.map(item => (
                    <SideItem key={item.id} item={item} active={current === item.id} onSelect={onSelect} badge={badges[item.id]} />
                ))}
            </div>
        </aside>
    );
}

/** Phone header: just the brand, so the page still says what app it is. */
export function PhoneHeader() {
    return (
        <div className="md:hidden h-14 flex items-center gap-2 px-4 border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-30">
            <div className="w-7 h-7 rounded-lg bg-purple-600 grid place-items-center text-white"><Zap size={16} /></div>
            <span className="font-bold text-white tracking-tight">Speed AI</span>
        </div>
    );
}

/** Phone tab bar: four main destinations plus a sheet with everything else. */
export function PhoneTabBar({ current, onSelect, badges = {} }) {
    const [moreOpen, setMoreOpen] = useState(false);
    const inMore = !PHONE_TABS.includes(current);

    useEffect(() => {
        if (!moreOpen) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [moreOpen]);

    const select = (id) => { setMoreOpen(false); onSelect(id); };
    const moreBadge = ALL_ITEMS.filter(i => !PHONE_TABS.includes(i.id)).reduce((n, i) => n + (badges[i.id] ?? 0), 0);

    return (
        <>
            {moreOpen && (
                <div className="md:hidden fixed inset-0 z-40 flex flex-col justify-end">
                    <button aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={() => setMoreOpen(false)} />
                    <div className="relative bg-slate-900 border-t border-slate-800 rounded-t-3xl p-4 pb-24 animate-in slide-in-from-bottom-8" role="dialog" aria-label="More">
                        <div className="flex items-center justify-between mb-3 px-1">
                            <span className="text-sm font-bold text-white">More</span>
                            <button onClick={() => setMoreOpen(false)} aria-label="Close" className="text-slate-400 p-1"><X size={18} /></button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {ALL_ITEMS.filter(i => !PHONE_TABS.includes(i.id)).map(item => {
                                const Icon = item.icon;
                                const active = current === item.id;
                                return (
                                    <button
                                        key={item.id} onClick={() => select(item.id)}
                                        className={`relative flex flex-col items-center gap-1.5 py-3 rounded-2xl border text-xs font-medium ${
                                            active ? 'border-purple-500 bg-purple-500/10 text-purple-400' : 'border-slate-800 bg-slate-950 text-slate-300'
                                        }`}
                                    >
                                        <Icon size={20} />
                                        {item.label}
                                        {badges[item.id] > 0 && <span className="absolute top-2 right-3 w-2 h-2 rounded-full bg-purple-500" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
            <nav
                className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-slate-900/95 backdrop-blur border-t border-slate-800 grid grid-cols-5"
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
                aria-label="Main"
            >
                {PHONE_TABS.map(id => {
                    const item = ALL_ITEMS.find(i => i.id === id);
                    const Icon = item.icon;
                    const active = current === id && !moreOpen;
                    return (
                        <button
                            key={id} onClick={() => select(id)} aria-current={active ? 'page' : undefined}
                            className={`relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium ${active ? 'text-purple-400' : 'text-slate-500'}`}
                        >
                            <Icon size={20} />
                            {item.label.replace('Neuro-', '')}
                            {badges[id] > 0 && <span className="absolute top-2 right-[30%] w-2 h-2 rounded-full bg-purple-500" />}
                        </button>
                    );
                })}
                <button
                    onClick={() => setMoreOpen(o => !o)} aria-expanded={moreOpen}
                    className={`relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium ${moreOpen || inMore ? 'text-purple-400' : 'text-slate-500'}`}
                >
                    <LayoutGrid size={20} />
                    More
                    {moreBadge > 0 && <span className="absolute top-2 right-[30%] w-2 h-2 rounded-full bg-purple-500" />}
                </button>
            </nav>
        </>
    );
}
