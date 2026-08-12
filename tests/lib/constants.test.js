import { describe, expect, it } from 'vitest';
import {
    ALLOWED_OUTPUT_FORMATS,
    CONVERT_INPUT_FORMATS,
    CONVERT_OUTPUT_FORMATS,
    DEFAULT_QUALITY,
    HEIC_EXTENSIONS,
    HEIC_INPUT_FORMATS,
    HEIC_MIME_TYPES,
    MAX_BULK_FILES,
    MAX_BULK_TOTAL_BYTES,
    MAX_DIMENSION,
    MAX_FILE_SIZE,
    MAX_PIXELS,
    MAX_SCALE_PERCENT,
    MAX_TARGET_BYTES,
    MIN_TARGET_BYTES,
    RASTER_INPUT_FORMATS,
    RESIZE_INPUT_FORMATS,
    SOCIAL_PRESETS,
    TARGET_SEARCH_ITERATIONS,
    TOOLS,
    getSocialPreset,
    getTool,
    relatedTools,
    sitemapTools,
    socialPresetGroups,
} from '@/lib/constants';
import { parseCropParams } from '@/lib/image/crop';
import { parsePositiveInt, parseScale, scaleDimensions, withinPixelBudget } from '@/lib/image/dimensions';
import { contentTypeFor, extensionFor } from '@/lib/image/filename';
import { sniffImageType } from '@/lib/image/magic-bytes';
import { parseQuality } from '@/lib/image/quality';
import { parseTargetBytes } from '@/lib/image-client/target-bytes';
import { validateUpload } from '@/lib/image/validate';
import { HARD_MAX_SOURCE_PIXELS } from '@/lib/image-client/capability';

function fakeFile(size) {
    return { name: 'photo.jpg', type: 'image/jpeg', size, arrayBuffer: async () => new ArrayBuffer(0) };
}

describe('limits', () => {
    it('keeps the per-file cap at 20MB', () => {
        expect(MAX_FILE_SIZE).toBe(20971520);
        expect(MAX_FILE_SIZE).toBe(20 * 1024 * 1024);
    });

    it.each([
        ['MAX_DIMENSION', MAX_DIMENSION, 8000],
        ['MAX_PIXELS', MAX_PIXELS, 40000000],
        ['MAX_SCALE_PERCENT', MAX_SCALE_PERCENT, 400],
        ['MAX_BULK_FILES', MAX_BULK_FILES, 20],
        ['MAX_BULK_TOTAL_BYTES', MAX_BULK_TOTAL_BYTES, 83886080],
        ['DEFAULT_QUALITY', DEFAULT_QUALITY, 80],
    ])('pins %s', (_label, actual, expected) => {
        expect(actual).toBe(expected);
    });

    it('keeps every limit a positive safe integer', () => {
        const limits = [
            MAX_FILE_SIZE,
            MAX_DIMENSION,
            MAX_PIXELS,
                    MAX_SCALE_PERCENT,
            MAX_BULK_FILES,
            MAX_BULK_TOTAL_BYTES,
            DEFAULT_QUALITY,
        ];
        for (const limit of limits) {
            expect(Number.isSafeInteger(limit)).toBe(true);
            expect(limit).toBeGreaterThan(0);
        }
    });

    describe('the caps are mutually consistent', () => {
        it('lets a bulk request hold at least one maximum-size file', () => {
            expect(MAX_BULK_TOTAL_BYTES).toBeGreaterThanOrEqual(MAX_FILE_SIZE);
        });

        it('keeps the bulk byte budget under files x per-file cap', () => {
            expect(MAX_BULK_TOTAL_BYTES).toBeLessThanOrEqual(MAX_BULK_FILES * MAX_FILE_SIZE);
        });

        it('makes the pixel budget bind before the per-side cap does', () => {
            expect(MAX_PIXELS).toBeLessThan(MAX_DIMENSION * MAX_DIMENSION);
        });

        // The output budget must never gate the decode: a 48MP phone photo has
        // to come in before it can be shrunk to something under MAX_PIXELS.
        // MAX_DECODE_PIXELS used to say so — it was sharp's limitInputPixels and
        // it died with sharp. The source ceiling is now the browser's, and it is
        // both stricter and in a different unit of concern, so the invariant is
        // asserted against the constant that actually enforces it.
        it('lets the source ceiling sit above the output budget and above a 48MP photo', () => {
            expect(HARD_MAX_SOURCE_PIXELS).toBeGreaterThan(MAX_PIXELS);
            expect(HARD_MAX_SOURCE_PIXELS).toBeGreaterThan(8000 * 6000);
        });

        it('allows a square image at least as large as one full side', () => {
            expect(MAX_PIXELS).toBeGreaterThan(MAX_DIMENSION);
        });

        it('allows upscaling', () => {
            expect(MAX_SCALE_PERCENT).toBeGreaterThan(100);
        });

        it('keeps the default quality inside the 1-100 slider range', () => {
            expect(DEFAULT_QUALITY).toBeGreaterThanOrEqual(1);
            expect(DEFAULT_QUALITY).toBeLessThanOrEqual(100);
            expect(parseQuality(String(DEFAULT_QUALITY)).ok).toBe(true);
        });

        it('pins the size-target bounds at 10KB and the upload cap', () => {
            expect(MIN_TARGET_BYTES).toBe(10240);
            expect(MAX_TARGET_BYTES).toBe(MAX_FILE_SIZE);
        });

        // A target above the upload cap could only ever be met by handing the
        // original back untouched, which is not a compression result.
        it('never lets a reachable target exceed what can be uploaded', () => {
            expect(MAX_TARGET_BYTES).toBeLessThanOrEqual(MAX_FILE_SIZE);
            expect(MIN_TARGET_BYTES).toBeLessThan(MAX_TARGET_BYTES);
        });

        it('uses the same bounds in the parser as in the registry', () => {
            expect(parseTargetBytes(String(MIN_TARGET_BYTES)).ok).toBe(true);
            expect(parseTargetBytes(String(MIN_TARGET_BYTES - 1)).ok).toBe(false);
            expect(parseTargetBytes(String(MAX_TARGET_BYTES)).ok).toBe(true);
            expect(parseTargetBytes(String(MAX_TARGET_BYTES + 1)).ok).toBe(false);
        });

        // Binary search over 1-100 isolates a single value in ceil(log2(100))
        // = 7 probes, so anything below 7 cannot converge.
        it('gives the size search enough iterations to bisect the quality range', () => {
            expect(TARGET_SEARCH_ITERATIONS).toBeGreaterThanOrEqual(Math.ceil(Math.log2(100)));
            expect(TARGET_SEARCH_ITERATIONS).toBe(8);
        });
    });

    describe('every consumer enforces the same numbers', () => {
        it('uses MAX_FILE_SIZE as the upload cap and reports it in megabytes', () => {
            expect(validateUpload(fakeFile(MAX_FILE_SIZE)).ok).toBe(true);
            expect(validateUpload(fakeFile(MAX_FILE_SIZE + 1)).error)
                .toBe('File exceeds the maximum allowed size of 20MB.');
        });

        it('uses MAX_DIMENSION as the per-side cap for parsed dimensions', () => {
            expect(parsePositiveInt(String(MAX_DIMENSION), { max: MAX_DIMENSION }).ok).toBe(true);
            expect(parsePositiveInt(String(MAX_DIMENSION + 1), { max: MAX_DIMENSION }).ok).toBe(false);
        });

        it('uses MAX_DIMENSION as the per-side cap for crops', () => {
            const params = { x: '0', y: '0', width: String(MAX_DIMENSION + 1), height: '1' };
            expect(parseCropParams(params).ok).toBe(false);
        });

        it('uses MAX_DIMENSION as the per-side cap for scaled output', () => {
            expect(scaleDimensions(MAX_DIMENSION, 1, 200).ok).toBe(false);
        });

        it('uses MAX_SCALE_PERCENT as the scale cap', () => {
            expect(parseScale(String(MAX_SCALE_PERCENT)).ok).toBe(true);
            expect(parseScale(String(MAX_SCALE_PERCENT + 1)).ok).toBe(false);
        });

        it('uses MAX_PIXELS as the OUTPUT area budget everywhere', () => {
            expect(withinPixelBudget(MAX_PIXELS, 1)).toBe(true);
            expect(withinPixelBudget(MAX_PIXELS, 2)).toBe(false);
            expect(parseCropParams({
                x: '0',
                y: '0',
                width: String(MAX_DIMENSION),
                height: String(MAX_DIMENSION),
            }).ok).toBe(false);
        });
    });
});

describe('format allowlists', () => {
    it('pins the output formats', () => {
        expect(ALLOWED_OUTPUT_FORMATS).toEqual(['jpeg', 'png', 'webp']);
    });

    it('pins the raster input formats', () => {
        expect(RASTER_INPUT_FORMATS).toEqual(['jpeg', 'png', 'webp']);
    });

    it('pins the convert allowlists, which no longer carry AVIF', () => {
        expect(CONVERT_INPUT_FORMATS).toEqual(['jpeg', 'png', 'webp']);
        expect(CONVERT_OUTPUT_FORMATS).toEqual(['jpeg', 'png', 'webp']);
    });

    // AVIF used to be a /convert-only format in both directions. It is gone from
    // every list, including convert's: there is no AVIF decoder in the browser
    // build, and an AVIF encode costs 823 KB of extra download and 15-30 seconds
    // per image on a phone.
    it('keeps AVIF off every allowlist, convert included', () => {
        expect(RASTER_INPUT_FORMATS).not.toContain('avif');
        expect(RESIZE_INPUT_FORMATS).not.toContain('avif');
        expect(ALLOWED_OUTPUT_FORMATS).not.toContain('avif');
        expect(HEIC_INPUT_FORMATS).not.toContain('avif');
        expect(CONVERT_INPUT_FORMATS).not.toContain('avif');
        expect(CONVERT_OUTPUT_FORMATS).not.toContain('avif');
    });

    it('keeps the shared raster set inside the convert set', () => {
        for (const format of RASTER_INPUT_FORMATS) {
            expect(CONVERT_INPUT_FORMATS).toContain(format);
            expect(CONVERT_OUTPUT_FORMATS).toContain(format);
        }
    });

    it('pins the resize input formats', () => {
        expect(RESIZE_INPUT_FORMATS).toEqual(['jpeg', 'png', 'webp']);
    });

    it('pins the HEIC input formats', () => {
        expect(HEIC_INPUT_FORMATS).toEqual(['heic']);
    });

    it.each([
        ['ALLOWED_OUTPUT_FORMATS', ALLOWED_OUTPUT_FORMATS],
        ['RASTER_INPUT_FORMATS', RASTER_INPUT_FORMATS],
        ['RESIZE_INPUT_FORMATS', RESIZE_INPUT_FORMATS],
        ['CONVERT_INPUT_FORMATS', CONVERT_INPUT_FORMATS],
        ['CONVERT_OUTPUT_FORMATS', CONVERT_OUTPUT_FORMATS],
        ['HEIC_INPUT_FORMATS', HEIC_INPUT_FORMATS],
        ['HEIC_MIME_TYPES', HEIC_MIME_TYPES],
        ['HEIC_EXTENSIONS', HEIC_EXTENSIONS],
    ])('keeps %s lowercase and duplicate-free', (_label, list) => {
        expect(Array.isArray(list)).toBe(true);
        expect(list.length).toBeGreaterThan(0);
        expect(new Set(list).size).toBe(list.length);
        for (const entry of list) {
            expect(typeof entry).toBe('string');
            expect(entry).toBe(entry.toLowerCase());
        }
    });

    it('keeps the raster set inside the resize set', () => {
        for (const format of RASTER_INPUT_FORMATS) {
            expect(RESIZE_INPUT_FORMATS).toContain(format);
        }
    });

    it('keeps every output format acceptable as an input', () => {
        for (const format of ALLOWED_OUTPUT_FORMATS) {
            expect(RESIZE_INPUT_FORMATS).toContain(format);
        }
    });

    // GIF was a /resize-only input for as long as sharp did the decoding. The
    // browser build has no GIF decoder, so it is off every list now — including
    // resize's, which was the only one that ever carried it.
    it('accepts GIF nowhere, resize included', () => {
        expect(RESIZE_INPUT_FORMATS).not.toContain('gif');
        expect(RASTER_INPUT_FORMATS).not.toContain('gif');
        expect(ALLOWED_OUTPUT_FORMATS).not.toContain('gif');
        expect(CONVERT_INPUT_FORMATS).not.toContain('gif');
        expect(CONVERT_OUTPUT_FORMATS).not.toContain('gif');
    });

    it('keeps HEIC out of the raster paths', () => {
        for (const format of HEIC_INPUT_FORMATS) {
            expect(RESIZE_INPUT_FORMATS).not.toContain(format);
            expect(RASTER_INPUT_FORMATS).not.toContain(format);
        }
    });

    it('lets the upload gate through the declared MIME type of every resize input format', () => {
        for (const format of RESIZE_INPUT_FORMATS) {
            expect(validateUpload({ ...fakeFile(1024), type: `image/${format}` }).ok).toBe(true);
        }
    });

    // There is no exact-match MIME allowlist for the raster tools any more:
    // 'image/*' is the gate and the magic bytes are the decision. HEIC keeps a
    // named list because its uploads often arrive with no MIME type at all.
    it('keeps every HEIC MIME entry an image type that maps back to a known format', () => {
        for (const mime of HEIC_MIME_TYPES) {
            expect(mime.startsWith('image/')).toBe(true);
            expect(contentTypeFor(mime.slice('image/'.length))).toBe(mime);
        }
    });

    it('keeps every HEIC extension a dotted lowercase suffix', () => {
        for (const extension of HEIC_EXTENSIONS) {
            expect(extension.startsWith('.')).toBe(true);
            expect(extension.slice(1)).toMatch(/^[a-z0-9]+$/);
        }
    });

    it('gives every output format a usable extension and content type', () => {
        for (const format of [...ALLOWED_OUTPUT_FORMATS, ...CONVERT_OUTPUT_FORMATS]) {
            expect(extensionFor(format)).toMatch(/^[a-z0-9]+$/);
            expect(contentTypeFor(format)).toBe(`image/${format}`);
            expect(contentTypeFor(format)).not.toBe('application/octet-stream');
        }
    });

    // The sniffer recognises more than the site accepts, and that gap is the
    // point: 'we recognise this' is not 'we support this'. GIF and AVIF are
    // sniffed precisely so an upload can be refused for what it actually is
    // rather than reaching a decoder as something else. Every OTHER type it can
    // return has to be accepted somewhere, or the sniffer is returning a label
    // no allowlist has a use for.
    it('accepts every type the sniffer can return except the two it recognises only to refuse', () => {
        const accepted = (format) => RESIZE_INPUT_FORMATS.includes(format)
            || CONVERT_INPUT_FORMATS.includes(format)
            || HEIC_INPUT_FORMATS.includes(format);

        for (const format of ['jpeg', 'png', 'webp', 'heic']) {
            expect(accepted(format), `${format} is sniffable but on no allowlist`).toBe(true);
        }

        for (const format of ['gif', 'avif']) {
            expect(accepted(format), `${format} is sniffed to be refused, not accepted`).toBe(false);
        }

        expect(sniffImageType(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]))).toBe('jpeg');
    });
});

describe('social presets', () => {
    it('lists the twelve published placements', () => {
        expect(SOCIAL_PRESETS).toHaveLength(12);
        expect(SOCIAL_PRESETS.map((preset) => preset.id)).toEqual([
            'instagram-post',
            'instagram-portrait',
            'instagram-story',
            'instagram-profile',
            'youtube-thumbnail',
            'linkedin-post',
            'linkedin-banner',
            'x-post',
            'facebook-cover',
            'whatsapp-profile',
            'discord-avatar',
            'pinterest-pin',
        ]);
    });

    it.each([
        ['instagram-post', 1080, 1080],
        ['instagram-portrait', 1080, 1350],
        ['instagram-story', 1080, 1920],
        ['instagram-profile', 320, 320],
        ['youtube-thumbnail', 1280, 720],
        ['linkedin-post', 1200, 627],
        ['linkedin-banner', 1584, 396],
        ['x-post', 1600, 900],
        ['facebook-cover', 851, 315],
        ['whatsapp-profile', 500, 500],
        ['discord-avatar', 512, 512],
        ['pinterest-pin', 1000, 1500],
    ])('pins %s at %ix%i', (id, width, height) => {
        expect(getSocialPreset(id)).toMatchObject({ id, width, height });
    });

    it('gives every preset the full shape', () => {
        for (const preset of SOCIAL_PRESETS) {
            expect(preset.id).toMatch(/^[a-z0-9-]+$/);
            expect(preset.label.length).toBeGreaterThan(0);
            expect(preset.group.length).toBeGreaterThan(0);
            expect(Object.keys(preset).sort()).toEqual(['group', 'height', 'id', 'label', 'width']);
        }
    });

    it('keeps ids unique', () => {
        expect(new Set(SOCIAL_PRESETS.map((preset) => preset.id)).size).toBe(SOCIAL_PRESETS.length);
    });

    it('keeps labels unique, so two chips can never read the same', () => {
        expect(new Set(SOCIAL_PRESETS.map((preset) => preset.label)).size).toBe(SOCIAL_PRESETS.length);
    });

    it('keeps every id prefixed with its own group', () => {
        for (const preset of SOCIAL_PRESETS) {
            expect(preset.id.startsWith(`${preset.group.toLowerCase()}-`)).toBe(true);
        }
    });

    // A preset the resize route would reject is worse than no preset: the chip
    // would look like a supported size and return a 400.
    it('keeps every preset inside MAX_DIMENSION', () => {
        for (const preset of SOCIAL_PRESETS) {
            expect(Number.isSafeInteger(preset.width)).toBe(true);
            expect(Number.isSafeInteger(preset.height)).toBe(true);
            expect(preset.width).toBeGreaterThan(0);
            expect(preset.height).toBeGreaterThan(0);
            expect(preset.width).toBeLessThanOrEqual(MAX_DIMENSION);
            expect(preset.height).toBeLessThanOrEqual(MAX_DIMENSION);
        }
    });

    it('keeps every preset inside the MAX_PIXELS output budget', () => {
        for (const preset of SOCIAL_PRESETS) {
            expect(withinPixelBudget(preset.width, preset.height)).toBe(true);
        }
    });

    it('passes every preset dimension through the resize parser unchanged', () => {
        for (const preset of SOCIAL_PRESETS) {
            expect(parsePositiveInt(String(preset.width), { max: MAX_DIMENSION }))
                .toEqual({ ok: true, value: preset.width });
            expect(parsePositiveInt(String(preset.height), { max: MAX_DIMENSION }))
                .toEqual({ ok: true, value: preset.height });
        }
    });

    it('covers the platforms the strategy named', () => {
        const groups = new Set(SOCIAL_PRESETS.map((preset) => preset.group));
        expect([...groups]).toEqual([
            'Instagram',
            'YouTube',
            'LinkedIn',
            'X',
            'Facebook',
            'WhatsApp',
            'Discord',
            'Pinterest',
        ]);
    });
});

describe('getSocialPreset', () => {
    it('finds a preset by id', () => {
        expect(getSocialPreset('youtube-thumbnail')).toMatchObject({ width: 1280, height: 720 });
    });

    it.each([
        ['an unknown id', 'myspace-banner'],
        ['an empty string', ''],
        ['null', null],
        ['undefined', undefined],
        ['a number', 3],
        ['an object', {}],
    ])('returns null for %s', (_label, id) => {
        expect(getSocialPreset(id)).toBeNull();
    });
});

describe('socialPresetGroups', () => {
    it('keeps every preset exactly once, in registry order', () => {
        const flattened = socialPresetGroups().flatMap((entry) => entry.presets);
        expect(flattened).toEqual(SOCIAL_PRESETS);
    });

    it('emits one entry per platform', () => {
        const groups = socialPresetGroups();
        expect(groups.map((entry) => entry.group)).toEqual([
            'Instagram',
            'YouTube',
            'LinkedIn',
            'X',
            'Facebook',
            'WhatsApp',
            'Discord',
            'Pinterest',
        ]);
        expect(new Set(groups.map((entry) => entry.group)).size).toBe(groups.length);
    });

    it('puts all four Instagram placements under one heading', () => {
        const [instagram] = socialPresetGroups();
        expect(instagram.presets.map((preset) => preset.id)).toEqual([
            'instagram-post',
            'instagram-portrait',
            'instagram-story',
            'instagram-profile',
        ]);
    });
});

describe('tool registry', () => {
    it('lists the seven tools', () => {
        expect(TOOLS).toHaveLength(7);
        expect(TOOLS.map((tool) => tool.slug)).toEqual([
            'resize',
            'bulk-resize',
            'compress',
            'convert',
            'crop',
            'heic',
            'jpg-to-pdf',
        ]);
    });

    it('keeps slugs and hrefs unique', () => {
        expect(new Set(TOOLS.map((tool) => tool.slug)).size).toBe(TOOLS.length);
        expect(new Set(TOOLS.map((tool) => tool.href)).size).toBe(TOOLS.length);
    });

    it('gives every tool the full shape', () => {
        for (const tool of TOOLS) {
            expect(tool.slug).toMatch(/^[a-z-]+$/);
            expect(tool.href.startsWith('/')).toBe(true);
            expect(tool.title.length).toBeGreaterThan(0);
            expect(tool.shortTitle.length).toBeGreaterThan(0);
            expect(tool.description.length).toBeGreaterThan(0);
            expect(typeof tool.hasOwnPage).toBe('boolean');
        }
    });

    it('gives bulk resize a fragment href and no page of its own', () => {
        const bulk = getTool('bulk-resize');
        expect(bulk.hasOwnPage).toBe(false);
        expect(bulk.href).toBe('/resize#bulk');
    });

    it('routes every own-page tool at its slug', () => {
        for (const tool of TOOLS.filter((entry) => entry.hasOwnPage)) {
            expect(tool.href).toBe(`/${tool.slug}`);
        }
    });
});

describe('getTool', () => {
    it('finds a tool by slug', () => {
        expect(getTool('crop')).toMatchObject({ slug: 'crop', href: '/crop' });
    });

    it.each([
        ['an unknown slug', 'sharpen'],
        ['an empty string', ''],
        ['null', null],
        ['undefined', undefined],
        ['a number', 3],
        ['an object', {}],
    ])('returns null for %s', (_label, slug) => {
        expect(getTool(slug)).toBeNull();
    });
});

describe('relatedTools', () => {
    it('excludes the current tool and the tool with no page', () => {
        const related = relatedTools('resize');
        expect(related.map((tool) => tool.slug)).toEqual(['compress', 'convert', 'crop', 'heic', 'jpg-to-pdf']);
    });

    it('never links a tool without its own page', () => {
        for (const tool of TOOLS) {
            for (const related of relatedTools(tool.slug)) {
                expect(related.hasOwnPage).toBe(true);
                expect(related.slug).not.toBe(tool.slug);
            }
        }
    });

    it('returns every own-page tool for an unknown slug', () => {
        expect(relatedTools('sharpen')).toHaveLength(6);
        expect(relatedTools(undefined)).toHaveLength(6);
    });

    it('returns every own-page tool when asked from the bulk tab', () => {
        expect(relatedTools('bulk-resize')).toHaveLength(6);
    });
});

describe('sitemapTools', () => {
    it('emits only the tools that own a URL', () => {
        const slugs = sitemapTools().map((tool) => tool.slug);
        expect(slugs).toEqual(['resize', 'compress', 'convert', 'crop', 'heic', 'jpg-to-pdf']);
    });

    it('never emits a fragment URL', () => {
        for (const tool of sitemapTools()) {
            expect(tool.href).not.toContain('#');
            expect(tool.href.startsWith('/')).toBe(true);
        }
    });

    it('stays a subset of the registry', () => {
        for (const tool of sitemapTools()) {
            expect(TOOLS).toContain(tool);
        }
    });
});
