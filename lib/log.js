/**
 * Structured Logger
 *
 * One line of JSON per event. Vercel parses JSON written to the console into
 * queryable fields, so a single line carrying { code, route, requestId, ip,
 * bytes, durationMs } is the difference between "how many compress requests
 * 500'd today and why" being answerable and not.
 *
 * requestId comes from x-vercel-id, the header Vercel stamps on every
 * invocation, so a line here correlates with the platform's own log view.
 */

function serializeError(err) {
    if (err instanceof Error) {
        return { name: err.name, message: err.message, stack: err.stack };
    }
    if (err && typeof err === 'object') return err;
    return { message: String(err) };
}

function line(level, fields) {
    const { err, ...rest } = fields;
    const record = { level, time: new Date().toISOString() };

    for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined && value !== null) record[key] = value;
    }

    if (err !== undefined && err !== null) record.err = serializeError(err);

    return JSON.stringify(record);
}

export function log(level, fields = {}) {
    const serialized = line(level, fields);
    if (level === 'error') console.error(serialized);
    else if (level === 'warn') console.warn(serialized);
    else console.log(serialized);
}

export const logError = (fields) => log('error', fields);
export const logWarn = (fields) => log('warn', fields);
export const logInfo = (fields) => log('info', fields);

/** The Vercel invocation id, or null off-platform (Docker, local, tests). */
export function requestIdFrom(request) {
    const id = request?.headers?.get?.('x-vercel-id');
    return typeof id === 'string' && id ? id : null;
}
