/**
 * Sharp Pipeline Construction
 *
 * The ONLY module in the codebase allowed to import sharp. Every decode is
 * capped by the pixel budget and every encode goes through one place.
 */
import sharp from 'sharp';
import { DEFAULT_QUALITY, MAX_DECODE_PIXELS } from '@/lib/constants';
import { pngPaletteColours } from '@/lib/image/quality';

/**
 * Creates a sharp instance with the decode-side pixel cap applied.
 *
 * The cap is the source ceiling, not the output budget: MAX_PIXELS bounds what
 * comes out, and a 48MP phone photo has to decode before it can be shrunk.
 *
 * `.rotate()` with no argument bakes the EXIF Orientation into the pixels and
 * is REQUIRED, not optional. A phone stores a portrait photo as landscape
 * bytes plus an Orientation tag telling the viewer to turn it. We strip all
 * metadata on the way out — deliberately, it carries GPS — which throws that
 * tag away, so without this call the rotation is lost and every portrait phone
 * photo is returned on its side. Removing the tag and ignoring it are only
 * safe together.
 */
export function createPipeline(buffer) {
    return sharp(buffer, { limitInputPixels: MAX_DECODE_PIXELS }).rotate();
}

/**
 * Applies the output encoder.
 *
 * Metadata: sharp strips EXIF/GPS/IPTC/XMP by DEFAULT. Do not add
 * withMetadata(false) here or anywhere else — withMetadata() calls
 * keepMetadata() unconditionally and ignores its argument, so that call KEEPS
 * metadata. That inversion is the historic privacy bug; the fix is the absence
 * of the call.
 *
 * PNG: compressionLevel is always 9 because PNG is lossless, so a lower level
 * only costs bytes. Quantisation (palette + colours) is what actually shrinks a
 * PNG, and it turns on only when the caller passed a quality — plain format
 * conversion stays full-colour.
 *
 * AVIF: reachable from /convert only. It is a real encoder here, not an alias
 * for the jpeg default branch, so an unknown format string can never silently
 * produce AVIF bytes under an image/avif Content-Type.
 */
export function applyOutputFormat(pipeline, format, { quality, palette } = {}) {
    const hasQuality = typeof quality === 'number' && Number.isFinite(quality);
    const resolvedQuality = hasQuality ? quality : DEFAULT_QUALITY;

    switch (format) {
        case 'png': {
            const usePalette = palette ?? hasQuality;
            if (!usePalette) return pipeline.png({ compressionLevel: 9 });
            return pipeline.png({
                compressionLevel: 9,
                palette: true,
                quality: resolvedQuality,
                colours: pngPaletteColours(resolvedQuality),
            });
        }
        case 'webp':
            return pipeline.webp({ quality: resolvedQuality });
        case 'avif':
            return pipeline.avif({ quality: resolvedQuality });
        case 'jpeg':
        default:
            return pipeline.jpeg({ quality: resolvedQuality });
    }
}
