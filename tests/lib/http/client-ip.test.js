import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClientIp, makeRateLimitKey } from '@/lib/http/client-ip';

function request(headers = {}) {
    return { headers: new Headers(headers) };
}

describe('getClientIp', () => {
    it('prefers a trimmed x-real-ip', () => {
        expect(getClientIp(request({ 'x-real-ip': '1.2.3.4' }))).toBe('1.2.3.4');
        expect(getClientIp(request({ 'x-real-ip': '  1.2.3.4  ' }))).toBe('1.2.3.4');
    });

    it('lets x-real-ip win over x-forwarded-for', () => {
        expect(getClientIp(request({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }))).toBe('1.2.3.4');
    });

    it('returns null when no headers identify the caller', () => {
        expect(getClientIp(request())).toBeNull();
    });

    describe('empty values fall through instead of becoming a shared bucket', () => {
        it.each([
            ['an empty x-real-ip', { 'x-real-ip': '' }],
            ['a whitespace-only x-real-ip', { 'x-real-ip': '   ' }],
            ['an empty x-forwarded-for', { 'x-forwarded-for': '' }],
            ['a whitespace-only x-forwarded-for', { 'x-forwarded-for': '   ' }],
            ['a comma-only x-forwarded-for', { 'x-forwarded-for': ',,,' }],
            ['both headers empty', { 'x-real-ip': '', 'x-forwarded-for': '' }],
        ])('returns null for %s', (_label, headers) => {
            expect(getClientIp(request(headers))).toBeNull();
        });

        it('never returns an empty string', () => {
            const cases = [{}, { 'x-real-ip': '' }, { 'x-forwarded-for': ' , ' }, { 'x-forwarded-for': '1.1.1.1,' }];
            for (const headers of cases) {
                expect(getClientIp(request(headers))).not.toBe('');
            }
        });

        it('falls through an empty x-real-ip to x-forwarded-for', () => {
            expect(getClientIp(request({ 'x-real-ip': '', 'x-forwarded-for': '5.6.7.8' }))).toBe('5.6.7.8');
        });
    });

    describe('x-forwarded-for chains', () => {
        it.each([
            ['a single hop', '1.1.1.1', '1.1.1.1'],
            ['a three-hop chain, rightmost wins', '1.1.1.1, 2.2.2.2, 3.3.3.3', '3.3.3.3'],
            ['a chain with no spaces', '1.1.1.1,2.2.2.2', '2.2.2.2'],
            ['a trailing comma', '1.1.1.1,', '1.1.1.1'],
            ['a trailing comma and space', '1.1.1.1, ', '1.1.1.1'],
            ['a leading comma', ',2.2.2.2', '2.2.2.2'],
            ['an IPv6 address', '2001:db8::1', '2001:db8::1'],
            ['a mixed chain', '::1, 1.2.3.4', '1.2.3.4'],
            ['a bracketed IPv6 with a port', '[2001:db8::1]:8080', '[2001:db8::1]:8080'],
            ['an IPv6 zone identifier', 'fe80::1%eth0', 'fe80::1%eth0'],
        ])('handles %s', (_label, header, expected) => {
            expect(getClientIp(request({ 'x-forwarded-for': header }))).toBe(expected);
        });

        it('walks a 1000-hop chain without blowing up', () => {
            const chain = Array.from({ length: 1000 }, (_, index) => `10.0.0.${index % 255}`);
            chain.push('203.0.113.7');
            expect(getClientIp(request({ 'x-forwarded-for': chain.join(', ') }))).toBe('203.0.113.7');
        });
    });

    describe('injection attempts never become a Redis key', () => {
        // A raw headers stub, not a Headers instance: undici refuses to hold a
        // value containing CR/LF, so the guard can only be exercised directly.
        function rawRequest(values) {
            return { headers: { get: (name) => values[name] ?? null } };
        }

        const LF = String.fromCharCode(10);
        const CR = String.fromCharCode(13);
        const NUL = String.fromCharCode(0);

        it('rejects a newline in x-real-ip', () => {
            expect(getClientIp(rawRequest({ 'x-real-ip': `1.2.3.4${LF}FLUSHALL` }))).toBeNull();
        });

        it('rejects a CRLF in x-real-ip', () => {
            expect(getClientIp(rawRequest({ 'x-real-ip': `1.2.3.4${CR}${LF}DEL rl:resize` }))).toBeNull();
        });

        it('falls back to x-forwarded-for when x-real-ip is poisoned', () => {
            const ip = getClientIp(rawRequest({ 'x-real-ip': `1.2.3.4${LF}evil`, 'x-forwarded-for': '5.6.7.8' }));
            expect(ip).toBe('5.6.7.8');
        });

        it('falls back to an earlier hop when the rightmost entry is poisoned', () => {
            expect(getClientIp(rawRequest({ 'x-forwarded-for': `1.1.1.1, 2.2.2.2${LF}X: y` }))).toBe('1.1.1.1');
        });

        it('returns null when every hop in the chain is poisoned', () => {
            expect(getClientIp(rawRequest({ 'x-forwarded-for': `a b, c${LF}d` }))).toBeNull();
        });

        it.each([
            ['a space-separated payload', 'DEL key'],
            ['a quoted payload', '"1.2.3.4"'],
            ['a wildcard', '*'],
            ['a semicolon', '1.2.3.4;evil'],
            ['a slash', '1.2.3.4/24'],
            ['a null byte', `1.2.3.4${NUL}`],
            ['an inner tab', `1.2.3.4${String.fromCharCode(9)}evil`],
        ])('rejects %s', (_label, value) => {
            expect(getClientIp(rawRequest({ 'x-real-ip': value }))).toBeNull();
        });

        it('only ever returns characters that are safe in a key', () => {
            const headers = ['1.2.3.4', '2001:db8::1', '[::1]:80', 'fe80::1%eth0'];
            for (const value of headers) {
                expect(getClientIp(request({ 'x-real-ip': value }))).toMatch(/^[A-Za-z0-9.:%[\]_-]+$/);
            }
        });
    });

    describe('malformed requests', () => {
        it.each([
            ['null', null],
            ['undefined', undefined],
            ['an empty object', {}],
            ['a request with plain-object headers', { headers: { 'x-real-ip': '1.2.3.4' } }],
            ['a request whose headers.get is not callable', { headers: { get: 'nope' } }],
            ['a string', 'request'],
        ])('returns null for %s', (_label, input) => {
            expect(() => getClientIp(input)).not.toThrow();
            expect(getClientIp(input)).toBeNull();
        });
    });
});

describe('makeRateLimitKey', () => {
    it('namespaces a known IP under the bucket name', () => {
        expect(makeRateLimitKey('resize', '1.2.3.4')).toBe('resize:1.2.3.4');
    });

    it('gives each bucket its own namespace', () => {
        expect(makeRateLimitKey('bulk', '1.2.3.4')).not.toBe(makeRateLimitKey('resize', '1.2.3.4'));
    });

    it('trims the IP', () => {
        expect(makeRateLimitKey('resize', '  1.2.3.4  ')).toBe('resize:1.2.3.4');
    });

    it.each([
        ['an empty name', ''],
        ['null', null],
        ['undefined', undefined],
        ['a number', 7],
    ])('falls back to the default bucket for %s', (_label, name) => {
        expect(makeRateLimitKey(name, '1.2.3.4')).toBe('default:1.2.3.4');
    });

    describe('anonymous callers', () => {
        it.each([
            ['null', null],
            ['undefined', undefined],
            ['an empty string', ''],
            ['whitespace', '   '],
            ['a number', 5],
        ])('mints a per-request key for %s', (_label, ip) => {
            expect(makeRateLimitKey('resize', ip)).toMatch(/^resize:anon:.+/);
        });

        it('never lets two anonymous callers share a bucket', () => {
            const keys = new Set(Array.from({ length: 50 }, () => makeRateLimitKey('resize', null)));
            expect(keys.size).toBe(50);
        });

        describe('without crypto.randomUUID', () => {
            afterEach(() => {
                vi.unstubAllGlobals();
            });

            it('still mints a distinct key per request', () => {
                vi.stubGlobal('crypto', {});
                const keys = new Set(Array.from({ length: 20 }, () => makeRateLimitKey('resize', null)));
                expect(keys.size).toBe(20);
                for (const key of keys) {
                    expect(key).toMatch(/^resize:anon:.+/);
                }
            });
        });
    });

    it('never emits a newline into the key', () => {
        const keys = [
            makeRateLimitKey('resize', '1.2.3.4'),
            makeRateLimitKey('resize', null),
            makeRateLimitKey('bulk', '2001:db8::1'),
        ];
        for (const key of keys) {
            expect(key).not.toMatch(/[\r\n]/);
        }
    });
});
