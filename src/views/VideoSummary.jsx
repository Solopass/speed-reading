import { useState } from 'react';
import { Activity, Youtube } from 'lucide-react';
import { youtubeSpec } from '../lib/ai';
import { generateJson } from '../lib/gemini';
import ManualAiPanel from '../components/ManualAiPanel';

function YouTubeSync({ useApi, onStartPassage, addNotification }) {
    const [url, setUrl] = useState('');
    const [thumbnail, setThumbnail] = useState(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const spec = youtubeSpec({ url });

    const showThumbnail = () => {
        const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=))([^"&?/\s]{11})/);
        // hqdefault, not maxresdefault: YouTube only generates the latter for
        // videos uploaded in HD, so it 404s into a broken image for plenty of
        // them. Cleared when the URL is not a recognisable video, so a stale
        // thumbnail never sits beside a different video's passage.
        setThumbnail(match ? `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg` : null);
    };

    const acceptVideo = (data) => {
        if (!data?.text) throw new Error('That reply has no passage text in it.');
        showThumbnail();
        addNotification('Passage ready. Loading reader...');
        onStartPassage({ ...data, id: `yt-${Date.now()}` }, { source: 'youtube' });
    };

    const handleAnalyze = async () => {
        if (!url) return;
        showThumbnail();
        setIsAnalyzing(true);
        addNotification("Analyzing YouTube video...");
        try {
            acceptVideo(await generateJson({ prompt: `${spec.prompt}

Reply with raw JSON only matching: ${spec.shape}`, tools: spec.tools }));
        } catch (error) {
            console.error("YouTube Sync Error:", error);
            addNotification(error.message || "Failed to analyze video.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 pb-12">
             <div>
                <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                    <Youtube className="text-red-500 w-8 h-8"/> Video Summary
                </h1>
                <p className="text-slate-400 mt-2">
                    Turns a video into a reading passage. Note this is a summary written from what the model can find <em>about</em> the
                    video, not its transcript — treat the detail as approximate, and prefer a real article when accuracy matters.
                </p>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl">
                <input
                    type="text" value={url} onChange={e => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                    placeholder="Paste YouTube URL here..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-red-500 mb-4 outline-none transition-colors"
                />
                {useApi ? (
                    <button
                        onClick={handleAnalyze}
                        disabled={isAnalyzing || !url.trim()}
                        className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                        {isAnalyzing ? <Activity className="animate-spin" size={20} /> : <Youtube size={20}/>}
                        {isAnalyzing ? 'Summarising via AI...' : 'Summarise Video'}
                    </button>
                ) : (
                    <ManualAiPanel spec={spec} disabled={!url.trim()} addNotification={addNotification} onResult={acceptVideo} />
                )}
                {thumbnail && (
                    <div className="mt-6 rounded-xl overflow-hidden border border-slate-800 animate-in fade-in zoom-in-95 bg-slate-950">
                        <img src={thumbnail} alt="Video Thumbnail" className="w-full h-auto opacity-70 hover:opacity-100 transition-opacity" />
                    </div>
                )}
            </div>
        </div>
    );
}

export default YouTubeSync;
