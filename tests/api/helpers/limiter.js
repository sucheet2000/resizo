/**
 * Rate-limit control for route tests.
 *
 * Uses lib/http/rate-limit's own `setLimiter` seam rather than vi.mock-ing the
 * whole module. Replacing the module would mean hand-writing the 429 in the
 * mock, and the tests that assert X-RateLimit-Limit / X-RateLimit-Remaining /
 * Retry-After would then be asserting the mock instead of the shipped response
 * builder. With the seam, only the Upstash call is stubbed and every line from
 * getClientIp through tooManyRequests is the real one.
 */
import { vi } from 'vitest';
import { resetLimiters, setLimiter } from '@/lib/http/rate-limit';

export const RATE_LIMIT_RESET_MS = 45_000;

function install(name, result) {
    const limit = vi.fn(async () => result);
    setLimiter(name, { limit });
    return limit;
}

/** Installs a limiter that allows the request. Returns the spy on `limit`. */
export function allowLimiter(name, { limit = 10, remaining = 7 } = {}) {
    return install(name, {
        success: true,
        limit,
        remaining,
        reset: Date.now() + RATE_LIMIT_RESET_MS,
    });
}

/** Installs a limiter that denies the request. Returns the spy on `limit`. */
export function denyLimiter(name, { limit = 10, remaining = 0, resetInMs = RATE_LIMIT_RESET_MS } = {}) {
    return install(name, {
        success: false,
        limit,
        remaining,
        reset: Date.now() + resetInMs,
    });
}

export function clearLimiters() {
    resetLimiters();
}
