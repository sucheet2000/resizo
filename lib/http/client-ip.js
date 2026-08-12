/**
 * Client IP Extraction and Rate-Limit Keys
 */

// IPv4, IPv6, bracketed IPv6 and zone identifiers only. Anything else — a
// newline, a space, a stray header fragment — is not usable as a Redis key.
const IP_PATTERN = /^[A-Za-z0-9.:%[\]_-]+$/;

function firstUsable(values) {
    for (let i = values.length - 1; i >= 0; i -= 1) {
        const candidate = values[i].trim();
        if (candidate && IP_PATTERN.test(candidate)) return candidate;
    }
    return null;
}

/**
 * Returns the caller's IP or null. Prefers x-real-ip, then the rightmost
 * non-empty x-forwarded-for entry (the hop the platform appended).
 *
 * Returns null rather than '127.0.0.1' on purpose: a constant fallback funnels
 * every unidentifiable request into one shared bucket, so ten uploads from
 * anyone would lock out the whole internet.
 */
export function getClientIp(request) {
    const headers = request?.headers;
    if (!headers || typeof headers.get !== 'function') return null;

    const realIp = headers.get('x-real-ip');
    if (typeof realIp === 'string') {
        const trimmed = realIp.trim();
        if (trimmed && IP_PATTERN.test(trimmed)) return trimmed;
    }

    const forwardedFor = headers.get('x-forwarded-for');
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
        return firstUsable(forwardedFor.split(','));
    }

    return null;
}

function randomId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Builds the rate-limit identifier for a named bucket.
 *
 * With no IP the key is random per request, so anonymous callers each get
 * their own bucket instead of sharing one global counter.
 */
export function makeRateLimitKey(name, ip) {
    const bucket = typeof name === 'string' && name ? name : 'default';
    if (typeof ip === 'string' && ip.trim()) return `${bucket}:${ip.trim()}`;
    return `${bucket}:anon:${randomId()}`;
}
