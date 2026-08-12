/**
 * Named Rate Limiters
 *
 * Limiters are built lazily on first use and memoised. Nothing is constructed
 * at module scope: Redis.fromEnv() throws when the Upstash env vars are
 * missing, which used to take down the whole route at import time.
 *
 * Each name gets its OWN Redis key prefix. Without that, @upstash/ratelimit's
 * default prefix made all five image tools share one bucket, so compressing
 * ten images locked the user out of resizing.
 */
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { getClientIp, makeRateLimitKey } from '@/lib/http/client-ip';
import { tooManyRequests } from '@/lib/http/responses';

const REQUIRED_ENV = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];

const DEFAULT_CONFIG = { tokens: 10, window: '1 m' };

const LIMITS = {
    resize: { tokens: 10, window: '1 m' },
    compress: { tokens: 10, window: '1 m' },
    convert: { tokens: 10, window: '1 m' },
    crop: { tokens: 10, window: '1 m' },
    heic: { tokens: 10, window: '1 m' },
    bulk: { tokens: 5, window: '1 m' },
    signin: { tokens: 5, window: '1 m' },
    account: { tokens: 5, window: '1 m' },
};

const MESSAGES = {
    resize: 'Too many requests. Please wait a moment before resizing again.',
    compress: 'Too many requests. Please wait a moment before compressing again.',
    convert: 'Too many requests. Please wait a moment before converting again.',
    crop: 'Too many requests. Please wait a moment before cropping again.',
    heic: 'Too many requests. Please wait a moment before converting again.',
    bulk: 'Too many requests. Please wait before processing again.',
    signin: 'Too many sign-in attempts. Please wait before trying again.',
    account: 'Too many requests. Please wait a moment before trying again.',
};

const DEFAULT_MESSAGE = 'Too many requests. Please wait a moment before trying again.';

const limiters = new Map();

export class RateLimitConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RateLimitConfigError';
    }
}

export function limitConfigFor(name) {
    return LIMITS[name] ?? DEFAULT_CONFIG;
}

export function limitMessageFor(name) {
    return MESSAGES[name] ?? DEFAULT_MESSAGE;
}

/**
 * Returns the memoised limiter for a bucket name, constructing it on first
 * call. Throws a named error — never at import time — when Upstash is not
 * configured.
 */
export function getLimiter(name) {
    const bucket = typeof name === 'string' && name ? name : 'default';

    const existing = limiters.get(bucket);
    if (existing) return existing;

    const missing = REQUIRED_ENV.filter((variable) => !process.env[variable]);
    if (missing.length > 0) {
        throw new RateLimitConfigError(`Rate limiting is not configured: missing ${missing.join(', ')}.`);
    }

    const { tokens, window } = limitConfigFor(bucket);

    const limiter = new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(tokens, window),
        analytics: true,
        prefix: `rl:${bucket}`,
    });

    limiters.set(bucket, limiter);
    return limiter;
}

/** Test-only seam: drops the memoised limiters. */
export function resetLimiters() {
    limiters.clear();
}

/** Test-only seam: installs a stand-in limiter so tests need no Upstash. */
export function setLimiter(name, limiter) {
    limiters.set(name, limiter);
}

/**
 * Consumes one token and reports the full result, including `remaining` for
 * the success-path X-RateLimit-Remaining header.
 * Returns { ok, limit, remaining, reset, response }.
 */
export async function checkRateLimit(request, name) {
    const ip = getClientIp(request);
    const identifier = makeRateLimitKey(name, ip);

    const { success, limit, remaining, reset } = await getLimiter(name).limit(identifier);

    if (success) {
        return { ok: true, limit, remaining, reset, response: null };
    }

    return {
        ok: false,
        limit,
        remaining,
        reset,
        response: tooManyRequests(limitMessageFor(name), { limit, remaining, reset }),
    };
}

/**
 * Returns null when the request is allowed, or a ready-to-return 429.
 */
export async function enforceRateLimit(request, name) {
    const { response } = await checkRateLimit(request, name);
    return response;
}
