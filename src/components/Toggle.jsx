
function Toggle({ label, desc, checked, onChange }) {
    return (
        <div className="flex items-center justify-between p-4 bg-slate-950 border border-slate-800 rounded-2xl">
            <div className="pr-4">
                <div className="font-bold text-white">{label}</div>
                <div className="text-xs text-slate-500 mt-1">{desc}</div>
            </div>
            <button
                onClick={() => onChange(!checked)}
                className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${checked ? 'bg-purple-600' : 'bg-slate-700'}`}
            >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${checked ? 'left-7' : 'left-1'}`} />
            </button>
        </div>
    );
}

export default Toggle;
