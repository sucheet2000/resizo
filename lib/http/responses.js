/**
 * HTTP Response Builders
 *
 * The only module that touches next/server, so every other lib module stays
 * loadable in a bare Node process.
 */
import { NextResponse } from 'next/server';
import { contentDispositionValue, contentTypeFor } from '@/lib/image/filename';

/**
 * A non-enumerable marker the route wrapper reads to log the output size and
 * format without re-measuring the body it just built. Only imageResponse sets
 * it, so a zip (bulk) is never mistaken for a single processed image.
 */
export const RESPONSE_META = Symbol('resizo.responseMeta');

function retryAfterSeconds(reset) {
    if (typeof reset !== 'number' || !Number.isFinite(reset)) return 60;
    return Math.max(1, Math.ceil((reset - Date.now()) / 1000));
}

export function jsonError(message, status = 400) {
    return NextResponse.json({ error: message }, { status });
}

/**
 * The 429 shape shared by every rate-limited route, including the Retry-After
 * header all seven of them used to omit.
 */
export function tooManyRequests(message, { limit, remaining, reset } = {}) {
    const headers = new Headers();
    if (limit !== undefined && limit !== null) headers.set('X-RateLimit-Limit', String(limit));
    if (remaining !== undefined && remaining !== null) headers.set('X-RateLimit-Remaining', String(remaining));
    headers.set('Retry-After', String(retryAfterSeconds(reset)));

    return NextResponse.json({ error: message }, { status: 429, headers });
}

/**
 * Binary download response. Content-Length is deliberately not set — the
 * runtime computes it, and a hand-set value that disagrees with the wire body
 * truncates the response.
 *
 * `extra` carries the per-tool reporting headers (the compress size trio). It
 * is applied FIRST so nothing a caller passes can displace the derived
 * Content-Type, Content-Disposition or Cache-Control.
 */
export function binaryResponse(buffer, { contentType, filename, remaining, extra } = {}) {
    const headers = new Headers();

    for (const [key, value] of Object.entries(extra ?? {})) {
        if (value === undefined || value === null) continue;
        headers.set(key, String(value));
    }

    headers.set('Content-Type', contentType || 'application/octet-stream');
    if (filename) headers.set('Content-Disposition', contentDispositionValue(filename));
    if (remaining !== undefined && remaining !== null) headers.set('X-RateLimit-Remaining', String(remaining));
    headers.set('Cache-Control', 'no-store');

    return new NextResponse(buffer, { status: 200, headers });
}

export function imageResponse(buffer, { format, filename, remaining, extra } = {}) {
    const response = binaryResponse(buffer, { contentType: contentTypeFor(format), filename, remaining, extra });

    Object.defineProperty(response, RESPONSE_META, {
        value: { outputFormat: format, outputBytes: buffer?.length },
        enumerable: false,
    });

    return response;
}
