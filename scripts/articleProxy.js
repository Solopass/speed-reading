// Dev/preview-server route that fetches an article for URL import.
//
// The browser cannot fetch arbitrary origins, so the Vite server does it. That
// makes it a server-side request forger if left open: a page URL that resolves
// to this PC or the LAN (a router admin page, the local AI server) must never
// be fetched. Every hop is checked after DNS resolution, redirects included.

import dns from 'node:dns/promises';
import { Buffer } from 'node:buffer';
import { lookup as dnsLookupCb } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const MAX_REDIRECTS = 5;
const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 10_000;

/** True for addresses that must never be fetched: loopback, private, link-local, CGNAT, multicast, unspecified. */
export function isPrivateAddress(ip) {
    let addr = String(ip).toLowerCase().replace(/^\[|\]$/g, '');
    // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1) is the IPv4 address underneath.
    const mapped = addr.match(/^::ffff:(.+)$/);
    if (mapped) {
        const tail = mapped[1];
        if (net.isIPv4(tail)) addr = tail;
        else {
            const parts = tail.split(':');
            if (parts.length === 2) {
                const hi = parseInt(parts[0], 16);
                const lo = parseInt(parts[1], 16);
                addr = [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
            }
        }
    }
    if (net.isIPv4(addr)) {
        const [a, b] = addr.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 || a >= 224
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 100 && b >= 64 && b <= 127);
    }
    if (net.isIPv6(addr)) {
        // Forms that embed an IPv4 address: NAT64 (64:ff9b::/96), 6to4 (2002::/16)
        // and the old IPv4-compatible ::a.b.c.d. Refused outright rather than decoded.
        if (/^64:ff9b:/.test(addr) || /^2002:/.test(addr) || /^::\d+\.\d+\.\d+\.\d+$/.test(addr)) return true;
        return addr === '::' || addr === '::1'
            || /^fe[c-f]/.test(addr)        // fec0::/10 site local (deprecated)
            || /^f[cd]/.test(addr)          // fc00::/7 unique local
            || /^fe[89ab]/.test(addr)       // fe80::/10 link local
            || /^ff/.test(addr);            // multicast
    }
    return true; // not an IP at all: refuse rather than guess
}

/** Throws unless the URL is http(s) and every address its host resolves to is public. */
export async function assertPublicUrl(url, lookup = dns.lookup) {
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https URLs can be imported.');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
        throw new Error('Only public article URLs are allowed.');
    }
    const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(a => isPrivateAddress(a.address))) {
        throw new Error('Only public article URLs are allowed.');
    }
}

/**
 * DNS lookup for the actual connection, refusing private addresses. Checking a
 * name and then letting the HTTP client resolve it again leaves a window for
 * DNS rebinding (public answer for the check, 127.0.0.1 for the connection),
 * so the address the socket connects to is the one checked here.
 */
export function guardedLookup(hostname, options, callback) {
    const opts = typeof options === 'function' ? {} : (options ?? {});
    const cb = typeof options === 'function' ? options : callback;
    dnsLookupCb(hostname, { ...opts, all: true, verbatim: true }, (err, addresses) => {
        if (err) { cb(err); return; }
        const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIP(addresses) }];
        if (!list.length || list.some(a => isPrivateAddress(a.address))) {
            cb(new Error('Only public article URLs are allowed.'));
            return;
        }
        if (opts.all) cb(null, list);
        else cb(null, list[0].address, list[0].family);
    });
}

/** One GET with the guarded lookup. Resolves { status, headers, res } without reading the body. */
function requestOnce(url, signal) {
    return new Promise((resolve, reject) => {
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(url, {
            method: 'GET',
            lookup: guardedLookup,
            signal,
            headers: { 'User-Agent': 'SpeedAI-Reader/1.0', Accept: 'text/html,application/xhtml+xml' }
        }, (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, res }));
        req.on('error', reject);
        req.end();
    });
}

/** Reads a response body as UTF-8, aborting once it passes MAX_BYTES (chunked responses have no length to check up front). */
function readCapped(res) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BYTES) {
                res.destroy();
                reject(new Error('That page is too large to import.'));
                return;
            }
            chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
    });
}

async function fetchPublicHtml(startUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        let url = startUrl;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            await assertPublicUrl(url);
            const { status, headers, res } = await requestOnce(url, controller.signal);
            if (status >= 300 && status < 400) {
                res.resume();
                const location = headers.location;
                if (!location) throw new Error(`Upstream returned ${status} without a redirect target.`);
                url = new URL(location, url);
                continue;
            }
            if (status < 200 || status >= 300) { res.resume(); throw new Error(`Upstream returned ${status}.`); }
            const type = String(headers['content-type'] ?? '');
            if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
                res.resume();
                throw new Error(`That URL is not a web page (${type.split(';')[0] || 'unknown type'}). Download the file and upload it instead.`);
            }
            if (Number(headers['content-length']) > MAX_BYTES) { res.destroy(); throw new Error('That page is too large to import.'); }
            const html = await readCapped(res);
            return { html, url: url.toString() };
        }
        throw new Error('Too many redirects.');
    } finally {
        clearTimeout(timer);
    }
}

export function articleProxyMiddleware(req, res, next) {
    if (!req.url?.startsWith('/api/fetch-article')) { next(); return; }
    const reply = (status, body) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
    };
    let parsed;
    try {
        parsed = new URL(new URL(req.url, 'http://127.0.0.1').searchParams.get('url') || '');
    } catch {
        reply(400, { error: 'Invalid URL.' });
        return;
    }
    fetchPublicHtml(parsed)
        .then(data => reply(200, data))
        .catch(err => reply(err.name === 'AbortError' ? 504 : 400, {
            error: err.name === 'AbortError' ? 'Request timed out.' : err.message
        }));
}

export function articleProxyPlugin() {
    return {
        name: 'article-proxy',
        configureServer(server) { server.middlewares.use(articleProxyMiddleware); },
        configurePreviewServer(server) { server.middlewares.use(articleProxyMiddleware); }
    };
}
