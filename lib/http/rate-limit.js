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
import { logError, logWarn, requestIdFrom } from '@/lib/log';

const REQUIRED_ENV = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];

// A hung Upstash otherwise adds @upstash/ratelimit's default 5s to every
// upload before failing open. 1.5s bounds that cost and makes the outcome
// deterministic instead of racing the Redis retry backoff.
const LIMITER_TIMEOUT_MS = 1500;

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
        // Off deliberately. Upstash's analytics ingests one event per request
        // into hourly Redis buckets keyed by the identifier — which here is
        // derived from the caller's IP — and keeps up to 256 hours of history.
        // The privacy policy says the IP is checked in the moment and not
        // stored, and we do not use the Upstash dashboard, so this stays false.
        analytics: false,
        prefix: `rl:${bucket}`,
        timeout: LIMITER_TIMEOUT_MS,
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

    let result;
    try {
        result = await getLimiter(name).limit(identifier);
    } catch (error) {
        // FAIL OPEN. A missing/blank Upstash config (RateLimitConfigError) or a
        // limiter network error must not take every tool, sign-in and account
        // route down at once with a 500. The tools are free and anonymous, so
        // availability beats the limiter; the outage is logged so it is not
        // silent.
        logError({
            code: 'RATELIMIT_UNAVAILABLE',
            route: name,
            requestId: requestIdFrom(request),
            ip,
            msg: 'rate limiter unavailable; failing open',
            err: error,
        });
        return { ok: true, limit: null, remaining: null, reset: null, response: null };
    }

    const { success, limit, remaining, reset, reason } = result;

    // A hung Upstash resolves { success: true, reason: 'timeout' } after the
    // configured timeout. Treat it as a fail-open too, and drop the header
    // rather than advertising the false `remaining: 0` the timeout carries.
    if (reason === 'timeout') {
        logWarn({
            code: 'RATELIMIT_UNAVAILABLE',
            route: name,
            requestId: requestIdFrom(request),
            ip,
            msg: 'rate limiter timed out; failing open',
        });
        return { ok: true, limit: null, remaining: null, reset: null, response: null };
    }

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
