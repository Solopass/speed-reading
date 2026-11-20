import { describe, expect, it } from 'vitest';
import { assertPublicUrl, isPrivateAddress } from './articleProxy';

describe('isPrivateAddress', () => {
    it('flags loopback, private, link-local, CGNAT and mapped addresses', () => {
        for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.26', '172.20.1.1', '169.254.1.1', '100.64.0.1', '0.0.0.0',
            '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '[::1]']) {
            expect(isPrivateAddress(ip), ip).toBe(true);
        }
    });

    it('flags IPv6 forms that embed or route to IPv4', () => {
        for (const ip of ['64:ff9b::7f00:1', '2002:7f00:1::1', '::127.0.0.1', 'fec0::1']) {
            expect(isPrivateAddress(ip), ip).toBe(true);
        }
    });

    it('allows public addresses', () => {
        for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111', '172.32.0.1']) {
            expect(isPrivateAddress(ip), ip).toBe(false);
        }
    });
});

describe('assertPublicUrl', () => {
    const lookupTo = (address) => async () => [{ address }];

    it('rejects a public-looking hostname that resolves to this machine', async () => {
        await expect(assertPublicUrl(new URL('http://sneaky.example/'), lookupTo('127.0.0.1'))).rejects.toThrow(/public/);
    });

    it('rejects literal private hosts, localhost names and other schemes', async () => {
        await expect(assertPublicUrl(new URL('http://[::ffff:127.0.0.1]/'))).rejects.toThrow();
        await expect(assertPublicUrl(new URL('http://printer.local/'))).rejects.toThrow();
        await expect(assertPublicUrl(new URL('file:///etc/passwd'))).rejects.toThrow(/http/);
    });

    it('accepts a host that resolves only to public addresses', async () => {
        await expect(assertPublicUrl(new URL('https://example.com/a'), lookupTo('93.184.216.34'))).resolves.toBeUndefined();
    });
});

describe('guardedLookup (the connection-time check)', () => {
    it('refuses a name that resolves to loopback at connect time', async () => {
        const { guardedLookup } = await import('./articleProxy');
        const err = await new Promise(resolve => guardedLookup('localhost', {}, (e) => resolve(e)));
        expect(err?.message).toMatch(/public/);
    });
});
