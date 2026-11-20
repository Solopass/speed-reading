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
        req.emit('close');
    });
    return req;
}

function mockRes() {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    res.body = '';
    res.writableEnded = false;
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.end = (data) => {
        res.writableEnded = true;
        res.body = typeof data === 'string' ? data : Buffer.from(data ?? '').toString('utf8');
        res.emit('finish');
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

    it('does not abort OCR when req closes normally after body upload', async () => {
        const minPdf = Buffer.from(
            '%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n' +
            '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n' +
            '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>endobj\n' +
            'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n' +
            'trailer<< /Size 4 /Root 1 0 R >>\nstartxref\n184\n%%EOF\n'
        );
        const req = mockReq({ method: 'POST', chunks: [minPdf] });
        const res = mockRes();
        await new Promise((resolve) => {
            res.on('finish', resolve);
            ocrPdfMiddleware(req, res, () => {});
        });
        expect(res.statusCode).toBe(200);
        expect(res.body.startsWith('%PDF-')).toBe(true);
    }, 15000);
});
