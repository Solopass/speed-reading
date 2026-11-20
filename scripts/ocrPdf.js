// Dev/preview-server route that runs local OCRmyPDF on demand for scanned PDFs.
//
// OCRmyPDF is spawned only for the duration of a single POST /api/ocr-pdf
// request, then exits and has its temp directory removed immediately. No
// background OCR daemon stays running.

import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const MAX_PDF_BYTES = 100 * 1024 * 1024;
const OCR_TIMEOUT_MS = 10 * 60 * 1000;

function firstExistingDir(candidates) {
    for (const dir of candidates) {
        if (dir && existsSync(dir)) return dir;
    }
    return null;
}

function findVersionedBin(baseDir, prefix) {
    if (!baseDir || !existsSync(baseDir)) return null;
    try {
        const match = readdirSync(baseDir)
            .filter(name => name.toLowerCase().startsWith(prefix.toLowerCase()))
            .sort()
            .pop();
        if (!match) return null;
        const bin = path.join(baseDir, match, 'bin');
        return existsSync(bin) ? bin : null;
    } catch {
        return null;
    }
}

/** Locates ocrmypdf and its Windows runtime tool directories without requiring a shell restart. */
export function findOcrToolchain(env = process.env) {
    const home = os.homedir();
    const progFiles = env.ProgramFiles || 'C:\\Program Files';
    const progFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    const extraDirs = [
        path.join(home, '.local', 'bin'),
        firstExistingDir([
            path.join(progFiles, 'Tesseract-OCR'),
            path.join(progFilesX86, 'Tesseract-OCR')
        ]),
        findVersionedBin(path.join(progFiles, 'gs'), 'gs') || findVersionedBin(path.join(progFilesX86, 'gs'), 'gs'),
        findVersionedBin(progFiles, 'qpdf') || findVersionedBin(progFilesX86, 'qpdf')
    ].filter(Boolean);

    const pathSep = process.platform === 'win32' ? ';' : ':';
    const searchDirs = [...extraDirs, ...(env.PATH || '').split(pathSep).filter(Boolean)];
    const exeName = process.platform === 'win32' ? 'ocrmypdf.exe' : 'ocrmypdf';

    let ocrmypdf = null;
    for (const dir of searchDirs) {
        const candidate = path.join(dir, exeName);
        if (existsSync(candidate)) {
            ocrmypdf = candidate;
            break;
        }
    }

    return {
        ocrmypdf,
        env: { ...env, PATH: [...new Set(searchDirs)].join(pathSep) }
    };
}

function runOcrmypdf(bin, args, env, signal) {
    return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { env, windowsHide: true });
        let stderr = '';
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
            if (stderr.length > 8000) stderr = stderr.slice(-8000);
        });
        const onAbort = () => {
            child.kill();
            reject(Object.assign(new Error('OCR cancelled.'), { name: 'AbortError' }));
        };
        if (signal?.aborted) { onAbort(); return; }
        signal?.addEventListener('abort', onAbort, { once: true });
        child.on('error', (err) => {
            signal?.removeEventListener('abort', onAbort);
            reject(err);
        });
        child.on('close', (code) => {
            signal?.removeEventListener('abort', onAbort);
            if (code === 0) resolve();
            else reject(new Error(stderr.trim() || `ocrmypdf exited with code ${code}.`));
        });
    });
}

/** Runs ocrmypdf on a PDF buffer in an isolated temp dir, cleaning up when finished or aborted. */
export async function ocrPdfBuffer(pdfBuffer, { force = false, signal } = {}) {
    const { ocrmypdf, env } = findOcrToolchain();
    if (!ocrmypdf) {
        const err = new Error('OCRmyPDF is not installed on this machine.');
        err.statusCode = 503;
        throw err;
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'speedread-ocr-'));
    const inputPath = path.join(tmpDir, 'input.pdf');
    const outputPath = path.join(tmpDir, 'output.pdf');
    try {
        await fs.writeFile(inputPath, pdfBuffer);
        const modeFlag = force ? '--force-ocr' : '--redo-ocr';
        try {
            await runOcrmypdf(ocrmypdf, [modeFlag, '--optimize', '0', '-l', 'eng', inputPath, outputPath], env, signal);
        } catch (err) {
            // Digital PDFs with some non-redoable elements fail --redo-ocr; fall back to --force-ocr.
            if (!force && err.name !== 'AbortError' && /--force-ocr|Tagged PDF|cannot be redo/i.test(err.message)) {
                await runOcrmypdf(ocrmypdf, ['--force-ocr', '--optimize', '0', '-l', 'eng', inputPath, outputPath], env, signal);
            } else {
                throw err;
            }
        }
        return await fs.readFile(outputPath);
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}

function readPdfBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_PDF_BYTES) {
                req.destroy();
                reject(Object.assign(new Error('PDF is too large for local OCR (100 MB limit).'), { statusCode: 413 }));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

export function ocrPdfMiddleware(req, res, next) {
    if (!req.url?.startsWith('/api/ocr-pdf')) { next(); return; }

    const sendJson = (status, body) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
    };

    if (req.method === 'GET') {
        const { ocrmypdf } = findOcrToolchain();
        sendJson(200, { available: Boolean(ocrmypdf) });
        return;
    }

    if (req.method !== 'POST') {
        sendJson(405, { error: 'Method not allowed.' });
        return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
    req.on('close', () => {
        if (!res.writableEnded) controller.abort();
    });

    const parsed = new URL(req.url, 'http://127.0.0.1');
    const force = parsed.searchParams.get('force') === '1';

    readPdfBody(req)
        .then((buf) => {
            if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
                throw Object.assign(new Error('Request body is not a valid PDF.'), { statusCode: 400 });
            }
            return ocrPdfBuffer(buf, { force, signal: controller.signal });
        })
        .then((outBuf) => {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Length', String(outBuf.length));
            res.end(outBuf);
        })
        .catch((err) => {
            if (res.writableEnded) return;
            const status = err.name === 'AbortError' ? 504 : (err.statusCode || 500);
            sendJson(status, { error: err.name === 'AbortError' ? 'OCR timed out or was cancelled.' : err.message });
        })
        .finally(() => clearTimeout(timer));
}

export function ocrPdfPlugin() {
    return {
        name: 'ocr-pdf',
        configureServer(server) { server.middlewares.use(ocrPdfMiddleware); },
        configurePreviewServer(server) { server.middlewares.use(ocrPdfMiddleware); }
    };
}
