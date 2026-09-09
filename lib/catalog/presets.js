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
 */
export const SOCIAL_PRESETS = [
    { id: 'instagram-post', label: 'Instagram post', width: 1080, height: 1080, group: 'Instagram' },
    { id: 'instagram-portrait', label: 'Instagram portrait', width: 1080, height: 1350, group: 'Instagram' },
    { id: 'instagram-story', label: 'Instagram story', width: 1080, height: 1920, group: 'Instagram' },
    { id: 'instagram-profile', label: 'Instagram profile', width: 320, height: 320, group: 'Instagram' },
    { id: 'youtube-thumbnail', label: 'YouTube thumbnail', width: 1280, height: 720, group: 'YouTube' },
    { id: 'linkedin-post', label: 'LinkedIn post', width: 1200, height: 627, group: 'LinkedIn' },
    { id: 'linkedin-banner', label: 'LinkedIn banner', width: 1584, height: 396, group: 'LinkedIn' },
    { id: 'x-post', label: 'X post', width: 1600, height: 900, group: 'X' },
    { id: 'facebook-cover', label: 'Facebook cover', width: 851, height: 315, group: 'Facebook' },
    { id: 'whatsapp-profile', label: 'WhatsApp profile', width: 500, height: 500, group: 'WhatsApp' },
    { id: 'discord-avatar', label: 'Discord avatar', width: 512, height: 512, group: 'Discord' },
    { id: 'pinterest-pin', label: 'Pinterest pin', width: 1000, height: 1500, group: 'Pinterest' },
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
