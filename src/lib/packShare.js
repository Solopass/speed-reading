// Sharing drill packs: as a link (the pack, compressed, travels inside the
// link itself, so no server is involved) or as a file. Links open the public
// online demo, since a link to someone's own PC would not work for anyone else.

import { normalizePack } from './drillPack';

export const SHARE_BASE = 'https://solopass.github.io/speed-reading/';
export const LINK_PREFIX = '#pack=';
/** Above this many characters a link gets unwieldy in chat apps; offer the file instead. */
export const MAX_LINK_CHARS = 30000;

const toBase64Url = (bytes) => {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (s) => {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
};

/** A real pack is a few kilobytes; anything that inflates past this is refused (a crafted link could expand to gigabytes). */
export const MAX_PACK_BYTES = 1_000_000;
const MAX_HASH_CHARS = 200_000;

async function pipe(bytes, stream, limit = Infinity) {
    const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
            await reader.cancel().catch(() => {});
            throw new Error('That pack is too large.');
        }
        chunks.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
}

/** What gets shared: the pack only (never library data, scores or settings). */
export function sharedPackData(pack) {
    const clean = normalizePack(pack);
    if (!clean) throw new Error('That is not a drill pack.');
    return clean;
}

/** A link that opens the pack in the online app. */
export async function packToLink(pack, base = SHARE_BASE) {
    const json = new TextEncoder().encode(JSON.stringify(sharedPackData(pack)));
    const packed = await pipe(json, new CompressionStream('deflate-raw'));
    return `${base}${LINK_PREFIX}${toBase64Url(packed)}`;
}

/** Reads a pack from a page address's #pack=… part; null if there is none or it is damaged. */
export async function packFromHash(hash) {
    if (typeof hash !== 'string' || !hash.startsWith(LINK_PREFIX) || hash.length > MAX_HASH_CHARS) return null;
    try {
        const bytes = await pipe(fromBase64Url(hash.slice(LINK_PREFIX.length)), new DecompressionStream('deflate-raw'), MAX_PACK_BYTES);
        return normalizePack(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
        return null;
    }
}

/** The pack as a downloadable file. */
export function downloadPackFile(pack) {
    const data = sharedPackData(pack);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = data.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'drill-pack';
    a.href = url;
    a.download = `${slug}.speedpack.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/** Reads a pack file's text; throws a readable error for anything else. */
export function packFromFileText(text) {
    if (String(text).length > MAX_PACK_BYTES) throw new Error('That file is too large to be a drill pack.');
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
    const pack = normalizePack(parsed);
    if (!pack) throw new Error('That file is not a drill pack.');
    return pack;
}
