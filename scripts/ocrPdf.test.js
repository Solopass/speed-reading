import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { findOcrToolchain, ocrPdfMiddleware } from './ocrPdf.js';

function mockReq({ url = '/api/ocr-pdf', method = 'GET', chunks = [] } = {}) {
    const req = new EventEmitter();
    req.url = url;
    req.method = method;
    req.destroy = () => {};
    queueMicrotask(() => {
        for (const c of chunks) req.emit('data', c);
        req.emit('end');
    });
    return req;
}

function mockRes() {
    const res = { statusCode: 200, headers: {}, body: '', writableEnded: false };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.end = (data) => {
        res.writableEnded = true;
        res.body = typeof data === 'string' ? data : Buffer.from(data ?? '').toString('utf8');
    };
    return res;
}

describe('ocrPdf', () => {
    it('returns an env with PATH populated from findOcrToolchain', () => {
        const res = findOcrToolchain({ PATH: '' });
        expect(typeof res.env.PATH).toBe('string');
    });

    it('passes unrelated routes to next()', () => {
        let called = false;
        ocrPdfMiddleware({ url: '/api/other' }, {}, () => { called = true; });
        expect(called).toBe(true);
    });

    it('rejects non-GET/POST methods with 405', () => {
        const res = mockRes();
        ocrPdfMiddleware({ url: '/api/ocr-pdf', method: 'DELETE' }, res, () => {});
        expect(res.statusCode).toBe(405);
        expect(JSON.parse(res.body).error).toMatch(/Method not allowed/);
    });

    it('rejects non-PDF request bodies with 400', async () => {
        const req = mockReq({ method: 'POST', chunks: [Buffer.from('not a pdf')] });
        const res = mockRes();
        ocrPdfMiddleware(req, res, () => {});
        await new Promise(r => setTimeout(r, 20));
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toMatch(/valid PDF/i);
    });
});
