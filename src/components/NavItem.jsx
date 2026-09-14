
function NavItem({ icon, label, active, onClick }) {
    return (
        <button
            onClick={onClick}
            className={`w-full flex items-center justify-center md:justify-start p-3 rounded-xl transition-all duration-200 group relative ${
                active ? 'bg-purple-600/10 text-purple-400' : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
            }`}
        >
            <div className={active ? 'text-purple-400' : 'text-slate-400 group-hover:text-slate-200'}>{icon}</div>
            <span className="ml-3 font-medium hidden md:block">{label}</span>
            <div className="absolute left-14 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 md:hidden pointer-events-none z-50 transition-opacity whitespace-nowrap">
                {label}
            </div>
        </button>
    );
}

export default NavItem;
