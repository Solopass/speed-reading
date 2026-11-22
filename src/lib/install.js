// Installing the app: the browser's install prompt fires once, early, so it is
// caught here (imported first thing in main.jsx) and offered later from Settings.

let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());

if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        deferred = event;
        notify();
    });
    window.addEventListener('appinstalled', () => { deferred = null; notify(); });
}

/** True when running as an installed app (its own window or home-screen icon). */
export const isInstalled = () => typeof window !== 'undefined'
    && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);

/** iPhone and iPad have no install prompt; Safari's Share menu has Add to Home Screen instead. */
export const isIos = () => typeof navigator !== 'undefined'
    && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const canPromptInstall = () => deferred !== null;

/** Shows the browser's install dialog. Resolves 'accepted', 'dismissed' or 'unavailable'. */
export async function promptInstall() {
    if (!deferred) return 'unavailable';
    const event = deferred;
    deferred = null;
    notify();
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome;
}

export function subscribeInstall(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Registers the offline worker, in the production build only (it would cache dev-server files). */
export function registerServiceWorker(base, isProduction) {
    if (!isProduction || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {});
    });
}
