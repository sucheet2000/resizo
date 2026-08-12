import { handleUpload } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { MAX_FILE_SIZE } from '@/lib/constants';
import { getClientIp } from '@/lib/http/client-ip';
import { enforceRateLimit } from '@/lib/http/rate-limit';
import { jsonError } from '@/lib/http/responses';
import { logError, requestIdFrom } from '@/lib/log';

export const runtime = 'nodejs';
export const maxDuration = 15;

// The client token authorises a single browser upload straight to Blob, scoped
// hard: only the image types the tools actually decode, never larger than the
// 20MB per-file cap the whole product enforces, and valid for a short window so
// a leaked token is useless minutes later. addRandomSuffix keeps two uploads of
// the same filename from overwriting one another.
// image/gif and image/avif were here while some tool still decoded them. No
// tool does now, so minting a token for one would only buy a file a trip to
// Blob and a 400 from the tool it was headed for.
const ALLOWED_CONTENT_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
];

const TOKEN_VALIDITY_MS = 60_000;

export async function POST(request) {
    const limited = await enforceRateLimit(request, 'blob');
    if (limited) return limited;

    // The browser cannot upload to Blob until the owner provisions a store and
    // sets BLOB_READ_WRITE_TOKEN. Until then there is no token to mint, so the
    // endpoint is honestly unavailable rather than failing deeper in the SDK.
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return jsonError('Direct upload is not available right now.', 503);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return jsonError('Invalid request body.', 400);
    }

    try {
        const result = await handleUpload({
            request,
            body,
            onBeforeGenerateToken: async () => ({
                allowedContentTypes: ALLOWED_CONTENT_TYPES,
                maximumSizeInBytes: MAX_FILE_SIZE,
                addRandomSuffix: true,
                validUntil: Date.now() + TOKEN_VALIDITY_MS,
            }),
        });

        return NextResponse.json(result);
    } catch (error) {
        logError({
            code: 'BLOB_TOKEN_ERROR',
            route: 'blob',
            requestId: requestIdFrom(request),
            ip: getClientIp(request),
            msg: 'client-upload token request failed',
            err: error,
        });
        return jsonError('Could not authorize the upload.', 400);
    }
}
