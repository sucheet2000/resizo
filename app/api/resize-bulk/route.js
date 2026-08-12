import JSZip from 'jszip';
import { withRateLimitedRoute } from '@/lib/api/with-tool-route';
import {
    ALLOWED_OUTPUT_FORMATS,
    MAX_BULK_FILES,
    MAX_BULK_TOTAL_BYTES,
    MAX_DIMENSION,
    RESIZE_INPUT_FORMATS,
} from '@/lib/constants';
import { binaryResponse, jsonError } from '@/lib/http/responses';
import { parsePositiveInt, withinPixelBudget } from '@/lib/image/dimensions';
import { buildOutputFilename, uniqueName } from '@/lib/image/filename';
import { sniffImageType } from '@/lib/image/magic-bytes';
import { applyOutputFormat, createPipeline } from '@/lib/image/pipeline';
import { validateUpload } from '@/lib/image/validate';

export const runtime = 'nodejs';
export const maxDuration = 60;

// The client has always sent 'original'; the route only ever checked for
// 'same', so every bulk job was silently re-encoded to JPEG and every
// transparent PNG lost its alpha channel. Both spellings resolve to the
// source format now.
const SOURCE_FORMAT_SENTINELS = new Set(['original', 'same']);

const DIMENSION_ERROR = 'Dimensions exceed maximum allowed values.';

/**
 * Walks every `file_N` entry instead of counting up from 0. The old
 * `while (formData.has('file_' + i))` loop stopped at the first gap, so a body
 * carrying file_0 and file_2 quietly lost an image.
 */
function collectUploads(formData) {
    const uploads = [];

    for (const [key, value] of formData.entries()) {
        if (!key.startsWith('file_')) continue;
        const suffix = key.slice(5);
        if (!/^[0-9]+$/.test(suffix)) continue;
        uploads.push({ index: Number(suffix), file: value, config: formData.get(`config_${suffix}`) });
    }

    uploads.sort((a, b) => a.index - b.index);
    return uploads;
}

function parseConfig(raw) {
    if (raw === null || raw === undefined || raw === '') return { ok: true, config: {} };
    if (typeof raw !== 'string') return { ok: false };

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { ok: false };
    }

    // Valid JSON of the wrong type used to pass: `null` parses fine and then
    // threw a TypeError on config.width, which surfaced as a 500.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false };

    return { ok: true, config: parsed };
}

function resolveOutputFormat(requested, sourceFormat) {
    if (requested === null || requested === undefined || requested === '') {
        return { ok: true, format: sourceFormat };
    }

    const normalized = String(requested).toLowerCase();

    if (SOURCE_FORMAT_SENTINELS.has(normalized)) {
        // Every accepted input is also an encodable output now, so the jpeg
        // fallback is a backstop rather than the GIF path it was written for.
        return {
            ok: true,
            format: ALLOWED_OUTPUT_FORMATS.includes(sourceFormat) ? sourceFormat : 'jpeg',
        };
    }

    if (!ALLOWED_OUTPUT_FORMATS.includes(normalized)) return { ok: false };

    return { ok: true, format: normalized };
}

function resolveResizeOptions(meta, config) {
    const width = parsePositiveInt(config.width, { max: MAX_DIMENSION });
    const height = parsePositiveInt(config.height, { max: MAX_DIMENSION });

    if (width.absent && height.absent) return { ok: true, options: null };
    if ((!width.ok && !width.absent) || (!height.ok && !height.absent)) {
        return { ok: false, error: DIMENSION_ERROR };
    }

    // sharp derives the omitted side from the aspect ratio, so it needs the
    // same ceiling as the side the caller supplied.
    const targetWidth = width.ok
        ? width.value
        : Math.max(1, Math.round(meta.width * (height.value / meta.height)));
    const targetHeight = height.ok
        ? height.value
        : Math.max(1, Math.round(meta.height * (width.value / meta.width)));

    if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
        return { ok: false, error: DIMENSION_ERROR };
    }
    if (!withinPixelBudget(targetWidth, targetHeight)) {
        return { ok: false, error: DIMENSION_ERROR };
    }

    const options = {};
    if (width.ok) options.width = width.value;
    if (height.ok) options.height = height.value;

    return { ok: true, options };
}

export const POST = withRateLimitedRoute({
    name: 'bulk',
    errorMessage: 'An internal server error occurred while processing the images.',
    handler: async ({ request, remaining }) => {
        let formData;
        try {
            formData = await request.formData();
        } catch {
            return jsonError('Invalid request body. Expected a multipart form upload.', 400);
        }

        const uploads = collectUploads(formData);

        if (uploads.length === 0) {
            return jsonError('No files provided.', 400);
        }
        if (uploads.length > MAX_BULK_FILES) {
            return jsonError(`A maximum of ${MAX_BULK_FILES} images can be processed in one request.`, 400);
        }

        const zip = new JSZip();
        const usedNames = new Set();
        let totalBytes = 0;

        for (const { index, file, config: rawConfig } of uploads) {
            const validation = validateUpload(file, { allowedTypes: ['image/*'] });
            if (!validation.ok) return jsonError(`File ${index}: ${validation.error}`, validation.status);

            // Per-file and per-count caps alone permit a 400MB request.
            totalBytes += file.size;
            if (totalBytes > MAX_BULK_TOTAL_BYTES) {
                return jsonError('The combined size of these files is too large for one request.', 413);
            }

            const buffer = Buffer.from(await file.arrayBuffer());

            const sourceFormat = sniffImageType(buffer);
            if (!sourceFormat || !RESIZE_INPUT_FORMATS.includes(sourceFormat)) {
                return jsonError(`File ${index} failed validation.`, 400);
            }

            const parsedConfig = parseConfig(rawConfig);
            if (!parsedConfig.ok) return jsonError(`Invalid configuration for file ${index}.`, 400);
            const config = parsedConfig.config;

            const outputFormat = resolveOutputFormat(config.format, sourceFormat);
            if (!outputFormat.ok) return jsonError(`Invalid output format for file ${index}.`, 400);

            let pipeline = createPipeline(buffer);

            // The source is only read for its aspect ratio; the pixel budget
            // applies to the requested output, not to what came in.
            const meta = await pipeline.metadata();

            const resize = resolveResizeOptions(meta, config);
            if (!resize.ok) return jsonError(resize.error, 400);
            if (resize.options) pipeline = pipeline.resize(resize.options);

            // resolveWithObject gives the output dimensions from the encode that
            // already happened, instead of decoding the result a second time.
            const { data, info } = await applyOutputFormat(pipeline, outputFormat.format)
                .toBuffer({ resolveWithObject: true });

            const entryName = buildOutputFilename({
                name: file.name,
                prefix: 'resizo',
                format: outputFormat.format,
                suffix: `${info.width}x${info.height}`,
            });

            zip.file(uniqueName(entryName, usedNames), data);
        }

        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

        return binaryResponse(zipBuffer, {
            contentType: 'application/zip',
            filename: 'resizo-bulk.zip',
            remaining,
        });
    },
});
