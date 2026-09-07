import React from 'react';

function StatCard({ icon, label, value, subtitle, color }) {
    return (
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl flex flex-col relative overflow-hidden group">
            <div className={`absolute top-0 right-0 p-6 opacity-10 ${color} group-hover:scale-110 transition-transform duration-500`}>
                {React.cloneElement(icon, { size: 64 })}
            </div>
            <div className={`mb-4 ${color}`}>{icon}</div>
            <div className="text-3xl font-black text-white mb-1 tracking-tight">{value}</div>
            <div className="text-sm font-bold text-slate-300 uppercase tracking-wider">{label}</div>
            <div className="text-xs text-slate-500 mt-2">{subtitle}</div>
        </div>
    );
}

export default StatCard;
