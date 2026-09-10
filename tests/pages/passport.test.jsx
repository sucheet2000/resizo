/**
 * /passport-photo — the static page.
 *
 * `lib/catalog/application-presets`, `lib/format/physical` and
 * `components/tools/FrameCrop` are mocked with the same faithful stand-ins
 * `tests/components/tools/passport-tool.test.jsx` uses for the tool panel —
 * this suite renders the WHOLE page, tool tree included, so the same three
 * imports have to resolve. What is under test is the page's own copy and
 * structure: its metadata, the direct-answer paragraph, and that every
 * verified preset the mock hands it is listed exactly once with its source
 * and the day it was checked.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { pageFacts } from './helpers/page-facts';

/**
 * Copied from the real `lib/catalog/application-presets/index.js` (Agent C
 * landed it after this suite was first drafted). Wrapped in `vi.hoisted()`
 * because `vi.mock` factories run above every top-level declaration in this
 * module — a plain `const` here is a "Cannot access before initialization"
 * away from happening the moment something in the static import graph
 * (this file's own `page.js` → `PassportTool.js` chain) touches the mock.
 *
 * The shape that matters most: a physical size carries the UNIT the
 * authority actually published in (`width`/`unit`), not only a millimetre
 * conversion (`widthMm`) — 2 in is 50.8 mm exactly, so the page's arithmetic
 * has to run on "2 in", never on a rounded "51 mm".
 */
const FIXTURES = vi.hoisted(() => {
    const usPrint = {
        id: 'us-passport-print',
        jurisdiction: 'United States',
        authority: 'U.S. Department of State',
        name: 'US passport photo (printed 2 × 2 in)',
        use: 'print',
        physical: { width: 2, height: 2, unit: 'in', widthMm: 50.8, heightMm: 50.8, statedAs: '2 x 2 inches (51 x 51 mm)' },
        digital: null,
        aspect: [1, 1],
        head: { minMm: 25, maxMm: 35, statedAs: 'from the bottom of the chin to the top of the head' },
        dpi: { required: false, default: 300 },
        bytes: { min: null, max: null },
        formats: ['jpeg', 'png'],
        formatsStated: false,
        background: { stated: 'plain white or off-white background free of shadows, textures, or objects', resizoSets: 'transparent-only' },
        enforces: ['dimensions', 'format', 'dpi'],
        cannotVerify: ['Eyes open and mouth closed, with no exaggerated expression', 'Head not tilted'],
        notes: ['Submit the original, unchanged photo.'],
        source: {
            label: 'U.S. Department of State, Passport Photos (Last Updated: March 24, 2026)',
            url: 'https://travel.state.gov/en/passports/apply/help/photos.html',
            verifiedAt: '2026-09-10',
        },
    };

    const ukPrint = {
        id: 'uk-passport-print',
        jurisdiction: 'United Kingdom',
        authority: 'HM Passport Office',
        name: 'UK passport photo (printed 45 × 35 mm)',
        use: 'print',
        physical: { width: 35, height: 45, unit: 'mm', widthMm: 35, heightMm: 45, statedAs: '45 millimetres (mm) high by 35mm wide' },
        digital: null,
        aspect: [7, 9],
        head: { minMm: 29, maxMm: 34, statedAs: 'from the crown of your head to your chin' },
        dpi: { required: false, default: 300 },
        bytes: { min: null, max: null },
        formats: ['jpeg', 'png'],
        formatsStated: false,
        background: { stated: 'plain cream or light grey background', resizoSets: 'transparent-only' },
        enforces: ['dimensions', 'format', 'dpi'],
        cannotVerify: ['No head covering, apart from religious or medical exceptions'],
        notes: ['Printed to a professional standard.'],
        source: {
            label: 'HM Passport Office, Photos for passports — photo requirements',
            url: 'https://www.gov.uk/photos-for-passports/photo-requirements',
            verifiedAt: '2026-09-10',
        },
    };

    const ukDigital = {
        id: 'uk-passport-digital',
        jurisdiction: 'United Kingdom',
        authority: 'HM Passport Office',
        name: 'UK passport photo (digital, 600 × 750 px)',
        use: 'digital',
        physical: null,
        digital: { minWidth: 600, minHeight: 750, maxWidth: null, maxHeight: null },
        aspect: [4, 5],
        head: null,
        dpi: { required: false, default: null },
        bytes: { min: 50 * 1024, max: 10 * 1024 * 1024 },
        formats: ['jpeg', 'png'],
        formatsStated: false,
        background: { stated: 'plain light-coloured background', resizoSets: 'transparent-only' },
        enforces: ['dimensions', 'format', 'maxBytes', 'minBytes'],
        cannotVerify: ['Taken in the last month'],
        notes: ['Do not crop your photo - it will be done for you.'],
        source: {
            label: 'HM Passport Office, Photos for passports',
            url: 'https://www.gov.uk/photos-for-passports',
            verifiedAt: '2026-09-10',
        },
    };

    const india = {
        id: 'india-passport-print',
        jurisdiction: 'India',
        authority: 'Ministry of External Affairs, Passport Seva',
        name: 'India passport photo (pasted 4.5 × 3.5 cm)',
        use: 'print',
        physical: { width: 3.5, height: 4.5, unit: 'cm', widthMm: 35, heightMm: 45, statedAs: 'recent passport size photograph (4.5 cm length x 3.5 cm width) in colour' },
        digital: null,
        aspect: [7, 9],
        head: null,
        dpi: { required: false, default: 300 },
        bytes: { min: null, max: null },
        formats: ['jpeg', 'png'],
        formatsStated: false,
        background: { stated: 'plain white, and the dress should be in dark colour', resizoSets: 'transparent-only' },
        enforces: ['dimensions', 'format', 'dpi'],
        cannotVerify: ['Frontal view of the full face should be visible'],
        notes: ['Not required for applications at PSK/POPSK.'],
        source: {
            label: 'Ministry of External Affairs, Passport Seva — Application Form Instruction Booklet V3.0, section B',
            url: 'https://www.passportindia.gov.in/AppOnlineProject/pdf/ApplicationformInstructionBooklet-V3.0.pdf',
            verifiedAt: '2026-09-10',
        },
    };

    return { usPrint, ukPrint, ukDigital, india, all: [usPrint, ukPrint, ukDigital, india] };
});

const US_PRINT = FIXTURES.usPrint;
const UK_PRINT = FIXTURES.ukPrint;
const UK_DIGITAL = FIXTURES.ukDigital;
const INDIA = FIXTURES.india;
const ALL_PRESETS = FIXTURES.all;

vi.mock('@/lib/catalog/application-presets', () => ({
    APPLICATION_PRESETS: FIXTURES.all,
    getApplicationPreset: (id) => FIXTURES.all.find((preset) => preset.id === id) ?? null,
    applicationPresetToRequirement: (preset, { dpi } = {}) => {
        const print = preset.use === 'print' && preset.physical;
        const resolution = Number.isFinite(dpi) && dpi > 0 ? dpi : (preset.dpi?.default ?? null);
        const toPx = (value, unit) => {
            const mm = unit === 'mm' ? value : unit === 'cm' ? value * 10 : unit === 'in' ? value * 25.4 : NaN;
            return Math.round((mm / 25.4) * resolution);
        };

        const { width, height } = print
            ? { width: toPx(preset.physical.width, preset.physical.unit), height: toPx(preset.physical.height, preset.physical.unit) }
            : { width: preset.digital?.minWidth ?? null, height: preset.digital?.minHeight ?? null };

        return {
            width,
            height,
            geometry: 'cover',
            format: preset.formats?.[0] ?? null,
            targetBytes: preset.bytes?.max ?? null,
            minBytes: preset.bytes?.min ?? null,
            dpi: print ? resolution : null,
        };
    },
}));

vi.mock('@/lib/format/physical', () => ({
    MM_PER_INCH: 25.4,
    toMillimetres: (value, unit) => {
        if (unit === 'mm') return value;
        if (unit === 'cm') return value * 10;
        if (unit === 'in') return value * 25.4;
        throw new Error(`unsupported unit: ${unit}`);
    },
    pixelsFor: (value, unit, dpi) => {
        const mm = unit === 'mm' ? value : unit === 'cm' ? value * 10 : unit === 'in' ? value * 25.4 : NaN;
        if (!Number.isFinite(mm) || mm <= 0 || !Number.isFinite(dpi) || dpi <= 0) {
            throw new Error('pixelsFor: invalid input');
        }
        return Math.round((mm / 25.4) * dpi);
    },
    describePhysical: (widthMm, heightMm) => `${widthMm} × ${heightMm} mm`,
}));

vi.mock('@/components/tools/FrameCrop', () => ({
    default: function FrameCropStub({ id, label }) {
        return <div role="group" aria-label={label} id={id} data-testid="frame-crop" />;
    },
}));

const { default: PassportPhotoPage, metadata } = await import('@/app/(tools)/passport-photo/page');
const { default: RequirementSummary } = await import('@/app/(tools)/passport-photo/RequirementSummary');

const HTML = renderToStaticMarkup(createElement(PassportPhotoPage));

const document = new DOMParser().parseFromString(
    `<!doctype html><html><body>${HTML}</body></html>`,
    'text/html',
);

const facts = pageFacts(HTML, metadata);

const ANSWER = 'A passport or ID photo has to satisfy several numbers one authority publishes at once — '
    + 'an exact pixel size or a size in millimetres or inches, an aspect ratio, a format, a byte ceiling '
    + 'and sometimes a DPI record — and missing one is why a photo gets rejected and re-taken. Resizo '
    + 'reads a verified preset or the numbers you type, then crops, resizes, formats and checks the photo '
    + 'you drop in against all of them at once, using a decoder and encoder the page hands to your own '
    + 'browser so the file is read and rewritten on your own device. It cannot judge pose, expression, '
    + 'lighting, background quality or eligibility — those judgements stay with you and the issuing '
    + 'authority, and every check Resizo can run is listed beside the ones it cannot.';

const SOURCES_HEADING = 'Where these requirements come from';

const NO_UPLOAD_CLAIM = /(?:no|not|never|without|nothing)[^.,;—]{0,40}(?:upload|uploading|leaving|leaves|server|install)|(?:on )?your own (?:device|computer)|in (?:your|this) browser/i;

const sourcesSection = () => {
    const heading = [...document.querySelectorAll('h2')].find((node) => node.textContent.trim() === SOURCES_HEADING);
    expect(heading, `the "${SOURCES_HEADING}" section is gone`).toBeTruthy();
    return heading.closest('section');
};

/** Only the OUTER list's direct <li> items — several of them carry a nested notes <ul> of their own. */
const sourceItems = () => [...sourcesSection().querySelector('ul').children];

describe('/passport-photo', () => {
    it('keeps its own canonical and exactly one h1, matching the plan’s exact wording', () => {
        expect(facts.metadata.alternates.canonical).toBe('https://www.resizo.net/passport-photo');
        expect(document.querySelectorAll('h1')).toHaveLength(1);
        expect(facts.h1).toBe('Make a Passport or ID Photo to Exact Size');
    });

    it('states its no-upload claim before the snippet is cut', () => {
        const description = facts.metadata.description ?? '';
        const match = description.match(NO_UPLOAD_CLAIM);
        expect(match, 'no no-upload claim found in the description').toBeTruthy();
        expect(match.index + match[0].length).toBeLessThanOrEqual(155);
    });

    it('renders the direct-answer paragraph under the panel, verbatim', () => {
        expect(facts.answer).toBe(ANSWER);
    });

    it('lists every verified preset exactly once, each with its source link and verified date', () => {
        const items = sourceItems();
        expect(items).toHaveLength(ALL_PRESETS.length);

        for (const preset of ALL_PRESETS) {
            const matches = items.filter((item) => item.textContent.includes(preset.name));
            expect(matches, `${preset.id} is listed ${matches.length} times, not once`).toHaveLength(1);

            const [item] = matches;
            const link = item.querySelector('a');
            expect(link, `${preset.id} has no source link`).toBeTruthy();
            expect(link.getAttribute('href')).toBe(preset.source.url);
            expect(link.getAttribute('rel')).toContain('noopener');

            const time = item.querySelector('time');
            expect(time, `${preset.id} has no verified date`).toBeTruthy();
            expect(time.getAttribute('datetime')).toBe(preset.source.verifiedAt);
            expect(item.textContent).toMatch(/checked \w+ \d{1,2}, \d{4}/);
        }
    });

    it('shows the pixel arithmetic for a millimetre preset in the exact shape the source facts quote', () => {
        const body = document.body.textContent.replace(/\s+/g, ' ');
        expect(body).toContain('35 mm × 300 DPI ÷ 25.4 = 413 px');
        expect(body).toContain('45 mm × 300 DPI ÷ 25.4 = 531 px');
    });

    /**
     * The US preset is published in inches, not millimetres, and 2 in is
     * 50.8 mm exactly — a ÷ 25.4 sentence written against the rounded 51 mm
     * figure would claim 602 px where the source's own unit gives 600.
     */
    it('runs the inch preset’s arithmetic on inches, with no millimetre rounding', () => {
        const body = document.body.textContent.replace(/\s+/g, ' ');
        expect(body).toContain('2 in × 300 DPI = 600 px');
        expect(body).not.toContain('51 mm');
    });

    it('runs the centimetre preset’s arithmetic through the same mm ÷ 25.4 step', () => {
        const body = document.body.textContent.replace(/\s+/g, ' ');
        expect(body).toContain('3.5 cm × 10 ÷ 25.4 × 300 DPI = 413 px');
        expect(body).toContain('4.5 cm × 10 ÷ 25.4 × 300 DPI = 531 px');
    });

    it('never invents a DPI default for the digital preset that publishes none', () => {
        const body = document.body.textContent.replace(/\s+/g, ' ');
        expect(body).toContain('Not stated — no print resolution to convert');
    });

    it('names Canada and states why no Canadian preset is offered', () => {
        const body = document.body.textContent.replace(/\s+/g, ' ');
        expect(body).toContain('Canada');
        expect(body).toMatch(/taken in person by a commercial photographer/i);
        expect(body).toMatch(/saved directly from the original file captured by the camera/i);
    });

    it('lists what Resizo can enforce and, separately, what it cannot verify', () => {
        expect(facts.headings.map((heading) => heading.text)).toContain('What Resizo can enforce, and what it cannot');
        const body = document.body.textContent;
        for (const preset of ALL_PRESETS) {
            for (const item of preset.cannotVerify) {
                expect(body, `${preset.id}'s cannotVerify text is missing`).toContain(item);
            }
        }
    });

    it('carries a SoftwareApplication, a BreadcrumbList, a HowTo and an FAQPage', () => {
        const types = facts.jsonLd.flat().map((node) => node['@type']);
        expect(types).toContain('SoftwareApplication');
        expect(types).toContain('BreadcrumbList');
        expect(types).toContain('HowTo');
        expect(types).toContain('FAQPage');
    });

    it('gives every FAQ entry both a question and an answer, matching the visible list', () => {
        expect(facts.headings.map((heading) => heading.text)).toContain('Frequently asked questions');
        const [faqPageNode] = facts.jsonLd.flat().filter((node) => node['@type'] === 'FAQPage');
        expect(faqPageNode.mainEntity.length).toBeGreaterThan(3);
    });
});

describe('RequirementSummary states its verdict in words, not colour alone', () => {
    it('renders Meets, Fails and Not required as literal text', () => {
        const html = renderToStaticMarkup(createElement(RequirementSummary, {
            checks: [
                { key: 'dimensions', label: 'Dimensions', required: '600×750 px', actual: '600×750 px', ok: true },
                { key: 'maxBytes', label: 'Maximum file size', required: '≤ 40 KB', actual: '45 KB', ok: false },
                { key: 'dpi', label: 'DPI', required: 'Not requested', actual: '—', ok: null },
            ],
            preset: US_PRINT,
        }));

        expect(html).toContain('Meets');
        expect(html).toContain('Fails');
        expect(html).toContain('Not required');
    });

    it('lists the cannotVerify rules and the source only for a named preset', () => {
        const withPreset = renderToStaticMarkup(createElement(RequirementSummary, {
            checks: [{ key: 'dimensions', label: 'Dimensions', required: '51×51 mm', actual: '51×51 mm', ok: true }],
            preset: US_PRINT,
        }));
        expect(withPreset).toContain('Eyes open and mouth closed, with no exaggerated expression');
        expect(withPreset).toContain(US_PRINT.source.url);

        const custom = renderToStaticMarkup(createElement(RequirementSummary, {
            checks: [{ key: 'dimensions', label: 'Dimensions', required: '600×600 px', actual: '600×600 px', ok: true }],
            preset: null,
        }));
        expect(custom).not.toContain('Eyes open and mouth closed, with no exaggerated expression');
    });

    it('renders nothing for an empty result, rather than an empty shell', () => {
        expect(renderToStaticMarkup(createElement(RequirementSummary, { checks: [], preset: null }))).toBe('');
    });
});
