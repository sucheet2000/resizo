/**
 * The HTTP layer every route shares: the limiter registry that decides which
 * Redis bucket a request lands in, and the response builders that shape every
 * 429 and every download. Upstash is mocked at the package boundary so the real
 * registry code runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { RatelimitMock, slidingWindowMock, fromEnvMock } = vi.hoisted(() => {
    const slidingWindowMock = vi.fn((tokens, window) => ({ kind: 'sliding', tokens, window }));
    const fromEnvMock = vi.fn(() => ({ kind: 'redis' }));

    class RatelimitMock {
        static slidingWindow = slidingWindowMock;

        constructor(options) {
            this.options = options;
            RatelimitMock.instances.push(this);
        }

        limit = vi.fn(async () => ({ success: true, limit: 10, remaining: 9, reset: Date.now() + 1000 }));
    }
    RatelimitMock.instances = [];

    return { RatelimitMock, slidingWindowMock, fromEnvMock };
});

vi.mock('@upstash/ratelimit', () => ({ Ratelimit: RatelimitMock }));
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: fromEnvMock } }));

const {
    RateLimitConfigError,
    checkRateLimit,
    enforceRateLimit,
    getLimiter,
    limitConfigFor,
    limitMessageFor,
    resetLimiters,
    setLimiter,
} = await import('@/lib/http/rate-limit');

const { binaryResponse, imageResponse, jsonError, tooManyRequests } = await import('@/lib/http/responses');

function request(headers = {}) {
    return { headers: new Headers(headers) };
}

beforeEach(() => {
    resetLimiters();
    RatelimitMock.instances.length = 0;
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fake.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'fake-token');
});

afterEach(() => {
    resetLimiters();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('the five image tools no longer share one Redis bucket', () => {
    it.each([
        ['resize', 'rl:resize', 10],
        ['compress', 'rl:compress', 10],
        ['convert', 'rl:convert', 10],
        ['crop', 'rl:crop', 10],
        ['heic', 'rl:heic', 10],
        ['bulk', 'rl:bulk', 5],
        ['signin', 'rl:signin', 5],
        ['account', 'rl:account', 5],
    ])('gives %s the prefix %s at %i requests a minute', (name, prefix, tokens) => {
        getLimiter(name);

        const [instance] = RatelimitMock.instances;
        expect(instance.options.prefix).toBe(prefix);
        expect(slidingWindowMock).toHaveBeenCalledWith(tokens, '1 m');
    });

    it('builds eight distinct prefixes across the eight buckets', () => {
        for (const name of ['resize', 'compress', 'convert', 'crop', 'heic', 'bulk', 'signin', 'account']) {
            getLimiter(name);
        }

        const prefixes = RatelimitMock.instances.map((instance) => instance.options.prefix);
        expect(new Set(prefixes).size).toBe(8);
    });

    it('memoises one limiter per name instead of rebuilding it per request', () => {
        const first = getLimiter('resize');
        const second = getLimiter('resize');

        expect(second).toBe(first);
        expect(RatelimitMock.instances).toHaveLength(1);
    });

    it('falls back to the default config for an unknown bucket', () => {
        expect(limitConfigFor('something-new')).toEqual({ tokens: 10, window: '1 m' });
        expect(limitMessageFor('something-new')).toBe('Too many requests. Please wait a moment before trying again.');
    });

    it('treats a missing name as the default bucket', () => {
        getLimiter(undefined);

        expect(RatelimitMock.instances[0].options.prefix).toBe('rl:default');
    });
});

describe('missing Upstash configuration', () => {
    it('throws a named error only when a limiter is actually needed', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');

        expect(() => getLimiter('resize')).toThrow(RateLimitConfigError);
        expect(() => getLimiter('resize')).toThrow(/UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN/);
        expect(fromEnvMock).not.toHaveBeenCalled();
    });

    it('names only the variable that is actually missing', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');

        expect(() => getLimiter('resize')).toThrow(/missing UPSTASH_REDIS_REST_TOKEN\./);
    });

    it('does not consult the environment once a limiter is installed', () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
        setLimiter('resize', { limit: vi.fn() });

        expect(() => getLimiter('resize')).not.toThrow();
    });
});

describe('checkRateLimit', () => {
    it('keys the bucket on the caller IP', async () => {
        const limit = vi.fn(async () => ({ success: true, limit: 10, remaining: 6, reset: Date.now() + 1000 }));
        setLimiter('resize', { limit });

        const result = await checkRateLimit(request({ 'x-real-ip': '198.51.100.4' }), 'resize');

        expect(limit).toHaveBeenCalledWith('resize:198.51.100.4');
        expect(result).toMatchObject({ ok: true, remaining: 6, response: null });
    });

    it('gives an unidentifiable caller a fresh key each time', async () => {
        const limit = vi.fn(async () => ({ success: true, limit: 10, remaining: 6, reset: Date.now() + 1000 }));
        setLimiter('resize', { limit });

        await checkRateLimit(request(), 'resize');
        await checkRateLimit(request(), 'resize');

        const [[first], [second]] = limit.mock.calls;
        expect(first).toMatch(/^resize:anon:/);
        expect(second).toMatch(/^resize:anon:/);
        expect(first).not.toBe(second);
    });

    it('returns a ready 429 when the bucket is empty', async () => {
        setLimiter('bulk', {
            limit: async () => ({ success: false, limit: 5, remaining: 0, reset: Date.now() + 30_000 }),
        });

        const { ok, response } = await checkRateLimit(request({ 'x-real-ip': '1.2.3.4' }), 'bulk');

        expect(ok).toBe(false);
        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({ error: 'Too many requests. Please wait before processing again.' });
    });

    it('enforceRateLimit returns null when the request is allowed', async () => {
        setLimiter('crop', {
            limit: async () => ({ success: true, limit: 10, remaining: 9, reset: Date.now() + 1000 }),
        });

        expect(await enforceRateLimit(request({ 'x-real-ip': '1.2.3.4' }), 'crop')).toBeNull();
    });
});

describe('response builders', () => {
    it('jsonError defaults to 400', async () => {
        const response = jsonError('nope');

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'nope' });
    });

    it('tooManyRequests always sets Retry-After, even with no reset supplied', () => {
        const response = tooManyRequests('slow down');

        expect(response.headers.get('Retry-After')).toBe('60');
        expect(response.headers.get('X-RateLimit-Limit')).toBeNull();
        expect(response.headers.get('X-RateLimit-Remaining')).toBeNull();
    });

    it('tooManyRequests derives Retry-After from the reset timestamp', () => {
        const response = tooManyRequests('slow down', { limit: 10, remaining: 0, reset: Date.now() + 30_000 });

        const retryAfter = Number(response.headers.get('Retry-After'));
        expect(retryAfter).toBeGreaterThan(25);
        expect(retryAfter).toBeLessThanOrEqual(30);
    });

    it('tooManyRequests never emits a negative Retry-After for a reset in the past', () => {
        const response = tooManyRequests('slow down', { reset: Date.now() - 10_000 });

        expect(Number(response.headers.get('Retry-After'))).toBe(1);
    });

    it('tooManyRequests reports a remaining of zero rather than omitting the header', () => {
        const response = tooManyRequests('slow down', { limit: 5, remaining: 0 });

        expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    });

    it('binaryResponse falls back to an opaque content type', () => {
        const response = binaryResponse(Buffer.from('x'));

        expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
        expect(response.headers.get('Content-Disposition')).toBeNull();
        expect(response.headers.get('Cache-Control')).toBe('no-store');
    });

    it('binaryResponse leaves Content-Length to the runtime', () => {
        const response = binaryResponse(Buffer.from('hello'), { contentType: 'application/zip', filename: 'a.zip' });

        expect(response.headers.get('Content-Length')).toBeNull();
    });

    it('imageResponse maps the format to a Content-Type from the allowlist', () => {
        expect(imageResponse(Buffer.from('x'), { format: 'webp', filename: 'a.webp' }).headers.get('Content-Type'))
            .toBe('image/webp');
        expect(imageResponse(Buffer.from('x'), { format: 'exe', filename: 'a.exe' }).headers.get('Content-Type'))
            .toBe('application/octet-stream');
    });
});
