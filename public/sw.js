// Offline support for the installed app.
//
// - Pages (navigations): network first, so a new deploy shows up at once;
//   the last copy is used when offline.
// - Built files under assets/: their names carry a content hash and never
//   change, so they are served from the cache once fetched. The cache is
//   trimmed so old deploys do not pile up.
// - Everything else from this app (icons, manifest, word list): cached copy
//   first, refreshed in the background.
// - Never touched: other sites (the local AI, Gemini, fonts CDN, article
//   fetches) and this app's own /api/ routes (article proxy, OCR), which must
//   always be live.

const PAGES = 'speed-ai-pages-v1';
const ASSETS = 'speed-ai-assets-v1';
const MAX_ASSETS = 150;
const SCOPE = self.registration.scope;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(PAGES)
            .then(cache => cache.addAll([SCOPE, `${SCOPE}manifest.webmanifest`, `${SCOPE}icons/icon-192.png`]))
            .catch(() => {})
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        for (const key of await caches.keys()) {
            if (key !== PAGES && key !== ASSETS) await caches.delete(key);
        }
        await self.clients.claim();
    })());
});

async function trimAssets() {
    const cache = await caches.open(ASSETS);
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(old);
}

async function networkFirstPage(request) {
    const cache = await caches.open(PAGES);
    try {
        const response = await fetch(request);
        // Only the app page itself; opening an image or the manifest in a tab is also a navigation.
        if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) cache.put(SCOPE, response.clone());
        return response;
    } catch {
        return (await cache.match(request)) || (await cache.match(SCOPE)) || Response.error();
    }
}

async function touch(cache, request, response) {
    // Cache keys keep insertion order; re-storing a file marks it recently used,
    // so trimming removes files old deploys used, not ones still in use.
    await cache.delete(request);
    await cache.put(request, response);
}

async function cacheFirstAsset(request, event) {
    const cache = await caches.open(ASSETS);
    const hit = await cache.match(request);
    if (hit) {
        event.waitUntil(touch(cache, request, hit.clone()).catch(() => {}));
        return hit;
    }
    const response = await fetch(request);
    if (response.ok) {
        await cache.put(request, response.clone());
        trimAssets();
    }
    return response;
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(PAGES);
    const hit = await cache.match(request);
    const refresh = fetch(request)
        .then(response => { if (response.ok) cache.put(request, response.clone()); return response; })
        .catch(() => hit);
    return hit || refresh;
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin || !request.url.startsWith(SCOPE)) return;
    if (url.pathname.includes('/api/')) return;

    if (request.mode === 'navigate') event.respondWith(networkFirstPage(request));
    else if (url.pathname.includes('/assets/')) event.respondWith(cacheFirstAsset(request, event));
    else event.respondWith(staleWhileRevalidate(request));
});
