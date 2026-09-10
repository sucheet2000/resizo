/**
 * Platform and application presets — the numbers a chip stands for.
 *
 * Published pixel dimensions for the platforms people actually resize for,
 * and the aspect ratios /crop offers. Both are product data rather than engine
 * limits: the engine never reads a preset, it is handed the width and height
 * the visitor's chip filled in.
 */

/**
 * `group` is the platform heading the preset renders under; `label` is the
 * literal placement, so a chip reads "Instagram story" and never an
 * abbreviation.
 *
 * Every entry must stay inside MAX_DIMENSION and the MAX_PIXELS output budget
 * in lib/limits.js — a preset that cannot be honoured is worse than no preset,
 * and lib/catalog/validate.js refuses one that strays.
 *
 * WHY EVERY ENTRY CARRIES A `source`
 *
 * These twelve numbers are factual claims about somebody else's product, and
 * they rot without anyone touching this file. Instagram moved the tallest feed
 * photo from 4:5 to 3:4 and this registry went on saying 1080×1350; YouTube
 * raised the recommended thumbnail to 3840×2160 and this registry went on
 * saying 1280×720. Neither was caught, because a bare number records nothing
 * about where it came from or when anyone last looked.
 *
 * So each preset now carries one of two things, and never neither:
 *
 *   source: { label, url, verifiedAt }   the platform's own help page states
 *                                        this size, and someone read that page
 *                                        on that day.
 *   source: null                         nobody official states it. The number
 *                                        is a common export size and the page
 *                                        says exactly that.
 *
 * `null` is an honest and common answer — five of the twelve use it — and it
 * is a decision, which is why `validatePresets` treats an ABSENT `source` key
 * as a fault while accepting an explicit null. A citation must be the platform
 * talking about itself; a tool blog restating the numbers is what this is here
 * to stop repeating.
 */
export const SOCIAL_PRESETS = [
    {
        id: 'instagram-post',
        label: 'Instagram post',
        width: 1080,
        height: 1080,
        group: 'Instagram',
        // "we make sure to upload it at the best quality resolution possible
        // (up to a width of 1080 pixels)" — and a square sits inside the
        // 1.91:1–3:4 range the same page keeps at original resolution.
        source: {
            label: 'Instagram Help Center',
            url: 'https://help.instagram.com/1631821640426723',
            verifiedAt: '2026-09-10',
        },
    },
    {
        id: 'instagram-portrait',
        label: 'Instagram portrait',
        width: 1080,
        height: 1440,
        group: 'Instagram',
        // "a width of 1080 pixels with a height between 566 and 1440 pixels".
        // 1440 is the tallest Instagram keeps; the old 1350 (4:5) is still
        // accepted but is no longer the boundary and is no longer stated.
        source: {
            label: 'Instagram Help Center',
            url: 'https://help.instagram.com/1631821640426723',
            verifiedAt: '2026-09-10',
        },
    },
    // Instagram's story help article describes the camera and the stickers and
    // states no size at all; the reels article gives a ratio range and a 720px
    // floor, not a story size. 1080×1920 is the export size everyone uses.
    { id: 'instagram-story', label: 'Instagram story', width: 1080, height: 1920, group: 'Instagram', source: null },
    // Nothing Instagram publishes states a profile-picture size. The 320 in the
    // resolution article is the minimum FEED width and is a different number
    // about a different thing.
    { id: 'instagram-profile', label: 'Instagram profile', width: 320, height: 320, group: 'Instagram', source: null },
    {
        id: 'youtube-thumbnail',
        label: 'YouTube thumbnail',
        width: 3840,
        height: 2160,
        group: 'YouTube',
        // "We recommend your custom thumbnails: Have a resolution of
        // 3840 x 2160 pixels for videos … with a minimum width of 640 pixels".
        // The old 1280×720 is still well above that floor, but it is not what
        // YouTube asks for any more.
        source: {
            label: 'YouTube Help',
            url: 'https://support.google.com/youtube/answer/72431',
            verifiedAt: '2026-09-10',
        },
    },
    {
        id: 'linkedin-post',
        label: 'LinkedIn post',
        width: 1200,
        height: 627,
        group: 'LinkedIn',
        // Recommended ratio 1.91:1 (1200 x 627 pixels) for a share image.
        source: {
            label: 'LinkedIn Help',
            url: 'https://www.linkedin.com/help/linkedin/answer/a563309',
            verifiedAt: '2026-09-10',
        },
    },
    {
        id: 'linkedin-banner',
        label: 'LinkedIn banner',
        width: 1584,
        height: 396,
        group: 'LinkedIn',
        // "1584 (w) x 396 (h) pixels (recommended)" for the profile background.
        source: {
            label: 'LinkedIn Help',
            url: 'https://www.linkedin.com/help/linkedin/answer/a568217',
            verifiedAt: '2026-09-10',
        },
    },
    // X states a supported ratio range (2:1 to 3:4) and a 5MB ceiling for post
    // images, and no pixel size anywhere. 1600×900 is a 16:9 export size that
    // lands inside that range — a convention, not a rule.
    { id: 'x-post', label: 'X post', width: 1600, height: 900, group: 'X', source: null },
    {
        id: 'facebook-cover',
        label: 'Facebook cover',
        width: 851,
        height: 315,
        group: 'Facebook',
        // A cover photo "loads fastest as an sRGB JPG file that's 851 pixels
        // wide, 315 pixels tall and less than 100 kilobytes".
        source: {
            label: 'Facebook Help Center',
            url: 'https://www.facebook.com/help/125379114252045',
            verifiedAt: '2026-09-10',
        },
    },
    // WhatsApp publishes no profile-photo size; its only stated number is a
    // 192px floor for picture quality. 500×500 is a common export size.
    { id: 'whatsapp-profile', label: 'WhatsApp profile', width: 500, height: 500, group: 'WhatsApp', source: null },
    // Discord asks for "around 200x200 pixels at minimum" and states no
    // recommended size. 512×512 is the conventional avatar export.
    { id: 'discord-avatar', label: 'Discord avatar', width: 512, height: 512, group: 'Discord', source: null },
    {
        id: 'pinterest-pin',
        label: 'Pinterest pin',
        width: 1000,
        height: 1500,
        group: 'Pinterest',
        // "We recommend using a 2:3 aspect ratio, or 1000 x 1500 pixels".
        source: {
            label: 'Pinterest Business Help',
            url: 'https://help.pinterest.com/en/business/article/pinterest-product-specs',
            verifiedAt: '2026-09-10',
        },
    },
];

export function getSocialPreset(id) {
    return SOCIAL_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * The presets in platform order, as [{ group, presets }], so a grouped select
 * or chip row never has to re-derive the grouping.
 */
export function socialPresetGroups() {
    const groups = [];
    for (const preset of SOCIAL_PRESETS) {
        const existing = groups.find((entry) => entry.group === preset.group);
        if (existing) existing.presets.push(preset);
        else groups.push({ group: preset.group, presets: [preset] });
    }
    return groups;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const LONG_DATE = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' };

/**
 * A verifiedAt is a calendar day in UTC, not an instant — parsing it as
 * midnight UTC and formatting it back in UTC is what stops a reader west of
 * Greenwich seeing the day before. Same rule as a guide's byline date; the
 * formatter is repeated rather than imported because that one lives in
 * components/ and lib/ never imports upwards.
 */
function formatVerifiedAt(iso) {
    if (typeof iso !== 'string' || !ISO_DATE.test(iso)) return '';
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', LONG_DATE);
}

function sourceProblem(source) {
    if (!source || typeof source !== 'object') return 'a source must be an object, or null';
    if (typeof source.url !== 'string' || !/^https:\/\/\S+$/.test(source.url)) {
        return 'a source needs an https url';
    }
    if (typeof source.label !== 'string' || source.label.trim() === '') {
        return 'a source needs a label naming the page it came from';
    }
    if (!ISO_DATE.test(source.verifiedAt ?? '') || source.verifiedAt > new Date().toISOString().slice(0, 10)) {
        return 'a source needs a verifiedAt calendar date that has already happened';
    }
    return null;
}

/**
 * Every way a preset can be wrong about itself, as [{ code, subject, message }]
 * — the same shape lib/catalog/validate.js returns, so the two lists can be
 * concatenated if this ever moves behind the catalogue gate.
 *
 * It checks the citation, not the number: no validator can know whether
 * Instagram still says 1440. What it can enforce is that a claim of a source
 * is well formed and dated in the past, that an entry declared its position
 * either way, and that the dimensions are pixels a resizer could honour.
 */
export function validatePresets(presets = SOCIAL_PRESETS) {
    const problems = [];
    const seen = new Set();

    for (const preset of presets) {
        const subject = preset?.id ?? '(unnamed preset)';
        const problem = (code, message) => problems.push({ code, subject, message });

        if (!preset || typeof preset !== 'object') {
            problem('preset-malformed', 'a preset must be an object');
            continue;
        }

        if (seen.has(preset.id)) {
            problem('preset-id-duplicate', `preset id "${subject}" is declared more than once`);
        }
        seen.add(preset.id);

        for (const side of ['width', 'height']) {
            const value = preset[side];
            if (!Number.isSafeInteger(value) || value <= 0) {
                problem(
                    'preset-dimension-invalid',
                    `preset "${subject}" has a ${side} of ${value}, which is not a whole number of pixels above zero`,
                );
            }
        }

        if (!Object.hasOwn(preset, 'source')) {
            problem(
                'preset-source-invalid',
                `preset "${subject}" declares no source — cite the platform's own page, or say null`,
            );
        } else if (preset.source !== null) {
            const reason = sourceProblem(preset.source);
            if (reason) problem('preset-source-invalid', `preset "${subject}": ${reason}`);
        }
    }

    return problems;
}

/**
 * The one sentence that tells a visitor how much to trust a chip. Sourced
 * sizes name the platform and the day the page was read; the rest say plainly
 * that they are a convention, because "Instagram story 1080×1920" reads like a
 * rule and is not one.
 */
export function describePreset(preset) {
    if (!hasVerifiedSource(preset)) return 'Common export size, not a platform rule';
    return `Stated by ${preset.source.label}, checked ${formatVerifiedAt(preset.source.verifiedAt)}`;
}

/**
 * Whether a chip may be described as platform-stated. The one predicate every
 * caller shares — the resize page's sources section and describePreset ask
 * this and never test the source for truthiness themselves, so a malformed or
 * future-dated citation reads as a common size everywhere at once.
 */
export function hasVerifiedSource(preset) {
    const source = preset?.source;
    return Boolean(source) && sourceProblem(source) === null;
}

/**
 * The six aspect ratios /crop offers as chips. Free-form is deliberately NOT
 * an entry here — it is what a visitor gets by leaving every chip unselected
 * and typing x/y/width/height directly, so there is no seventh row that says
 * "Free-form".
 *
 * Field names avoid `width`/`height` on purpose: those already mean pixel
 * dimensions everywhere else in this package (SOCIAL_PRESETS) and in the crop
 * engine (crop_width/crop_height). `ratioWidth`/`ratioHeight` are the two
 * sides of a proportion, not a size — an implementer who copies one of them
 * into a pixel field is exactly the bug this naming is meant to surface in
 * review.
 *
 * No platform name is its own entry here. "Instagram story" is a pixel
 * target (SOCIAL_PRESETS); a crop can only ever fit a shape inside a source
 * photo, and crop never upscales, so "crop to 1080×1920" is unhonourable on a
 * source smaller than that. A platform name may appear as a hint ON a ratio
 * chip — it must never become a chip of its own.
 */
export const ASPECT_RATIOS = [
    { id: 'square-1-1', label: 'Square', ratio: '1:1', ratioWidth: 1, ratioHeight: 1 },
    { id: 'standard-4-3', label: 'Standard', ratio: '4:3', ratioWidth: 4, ratioHeight: 3 },
    { id: 'classic-3-2', label: 'Classic', ratio: '3:2', ratioWidth: 3, ratioHeight: 2 },
    { id: 'portrait-4-5', label: 'Portrait', ratio: '4:5', ratioWidth: 4, ratioHeight: 5 },
    { id: 'widescreen-16-9', label: 'Widescreen', ratio: '16:9', ratioWidth: 16, ratioHeight: 9 },
    { id: 'tall-9-16', label: 'Tall', ratio: '9:16', ratioWidth: 9, ratioHeight: 16 },
];
