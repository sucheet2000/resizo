/**
 * FaviconTool
 *
 * Modelled on tests/components/tools/fit-tool.test.jsx and print-sheet-tool.test.jsx:
 * FrameCrop and useLocalProcess are stubbed the same faithful way (this suite
 * tests FaviconTool's, IconPreview's and IconAssets' own logic, not the
 * engine's), and the fake outcome's shape is exactly the contract the icons op
 * promises — `lib/format/icon-package.js` is real and landed, so ICON_ASSETS,
 * buildManifest and buildHtmlSnippet below are the actual package, not a guess
 * at it.
 *
 * IconPreview and IconAssets have no test file of their own — FaviconTool.js
 * is the only place either is composed, so their behaviour is proven here,
 * through the tool that renders them, exactly the way the plan scoped the two
 * test files this agent owns.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { imageFile, setInputFiles, stubImageProbe } from '../helpers';
import { ICON_ASSETS, ZIP_FILENAME, buildHtmlSnippet, buildManifest } from '@/lib/format/icon-package';

vi.mock('@/components/tools/FrameCrop', () => ({
    default: function FrameCropStub({ id, label, aspect, value, onChange }) {
        return (
            <div role="group" aria-label={label} id={id} tabIndex={0} data-testid="frame-crop" data-aspect={aspect}>
                <span data-testid="frame-rect">{JSON.stringify(value)}</span>
                <button type="button" onClick={() => onChange({ x: 1, y: 2, width: 10, height: 10 })}>
                    Simulate drag
                </button>
            </div>
        );
    },
}));

const harness = vi.hoisted(() => ({
    submit: null,
    setResult: null,
    setFailure: null,
}));

vi.mock('@/lib/hooks/useLocalProcess', async () => {
    const { useState } = await import('react');

    return {
        default: function useStubbedProcess() {
            const [result, setResult] = useState(null);
            const [failure, setFailure] = useState(null);

            harness.setResult = (value) => { setFailure(null); setResult(value); };
            harness.setFailure = (value) => { setResult(null); setFailure(value); };

            return {
                submit: (...args) => harness.submit(...args),
                download: () => {},
                reset: () => { setResult(null); setFailure(null); },
                cancel: () => {},
                isProcessing: false,
                progress: 0,
                error: failure?.error ?? null,
                result,
                setError: () => {},
                phase: null,
                suggestion: failure?.suggestion ?? null,
                code: failure?.code ?? null,
            };
        },
    };
});

const { default: FaviconTool } = await import('@/app/(tools)/favicon-generator/FaviconTool');
const { iconPreviewDraw } = await import('@/app/(tools)/favicon-generator/IconPreview');

let probe;

/**
 * userEvent.setup() installs its OWN navigator.clipboard stub (to back its
 * .copy()/.paste() helpers), unconditionally, as part of setup — so a mock
 * defined before that call is immediately overwritten. Defining it AFTER
 * setup() is the only ordering that survives to the click — see
 * metadata-viewer-tool.test.jsx's own identical helper.
 */
function stubClipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    return writeText;
}

/** A synthetic blob of the given byte length — jsdom never decodes it, so the content is irrelevant, only its size. */
function blobOfSize(bytes, type = 'image/png') {
    return new Blob([new Uint8Array(bytes)], { type });
}

/** The engine's own package order, sizes and one fake blob per binary asset — the manifest is never in this array. */
const FAKE_ASSET_BYTES = {
    'favicon-ico': 1150,
    'favicon-16': 300,
    'favicon-32': 520,
    'apple-touch-icon': 4096,
    'android-192': 5200,
    'android-512': 20480,
};

function fakeAssets({ verified = true } = {}) {
    return ICON_ASSETS.filter((entry) => entry.kind !== 'manifest').map((entry) => ({
        id: entry.id,
        filename: entry.filename,
        type: entry.type ?? 'image/png',
        blob: blobOfSize(FAKE_ASSET_BYTES[entry.id], entry.kind === 'ico' ? 'image/x-icon' : 'image/png'),
        bytes: FAKE_ASSET_BYTES[entry.id],
        width: entry.width ?? null,
        height: entry.height ?? null,
        sizes: entry.sizes,
    }));
}

function fakeChecks({ ok = true } = {}) {
    return ICON_ASSETS.filter((entry) => entry.kind !== 'manifest').map((entry) => ({
        key: entry.filename,
        required: entry.kind === 'ico' ? entry.sizes.join(',') : `${entry.width}x${entry.height}`,
        actual: entry.kind === 'ico' ? entry.sizes.join(',') : `${entry.width}x${entry.height}`,
        ok,
    }));
}

function fakeOutcome(overrides = {}) {
    return {
        assets: fakeAssets(),
        checks: fakeChecks(),
        format: 'png',
        enlargedFrom: null,
        verified: true,
        ...overrides,
    };
}

beforeEach(() => {
    probe = stubImageProbe({ width: 640, height: 640 });
    harness.submit = vi.fn();
    harness.setResult = null;
    harness.setFailure = null;
});

afterEach(() => {
    probe.restore();
});

async function mountWithLogo({ width = 640, height = 640, name = 'logo.png' } = {}) {
    probe.configure({ width, height });
    const view = render(<FaviconTool />);
    const input = document.getElementById('icon-file');
    setInputFiles(input, [imageFile(name, 'png', { size: 200 * 1024 })]);
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {});
    return view;
}

const actionButton = () => screen.getByRole('button', { name: /^generate icons$/i });

/* -------------------------------------------------------------- intake */

describe('intake', () => {
    it('has a labelled dropzone at #icon-file with a Browse files button', () => {
        render(<FaviconTool />);
        expect(document.getElementById('icon-file')).toBeInTheDocument();
        expect(document.getElementById('icon-file-browse')).toBeInTheDocument();
    });

    it('offers the sample logo before any file is chosen, fetched from the documented path', async () => {
        const user = userEvent.setup();
        const fetched = [];
        const original = globalThis.fetch;
        globalThis.fetch = async (url) => { fetched.push(String(url)); return { ok: false }; };
        try {
            render(<FaviconTool />);
            await user.click(screen.getByRole('button', { name: /try the sample logo/i }));
        } finally {
            globalThis.fetch = original;
        }
        expect(fetched).toEqual(['/samples/logo-mark-640x400.png']);
    });

    it('moves focus to the crop frame once a logo is chosen', async () => {
        await mountWithLogo();
        expect(document.activeElement?.id).toBe('icon-frame');
    });

    it('does not submit without a logo, and says why', () => {
        render(<FaviconTool />);
        expect(actionButton()).toBeDisabled();
        expect(screen.getByText('Add a logo to turn this on.')).toBeInTheDocument();
    });
});

/* ------------------------------------------------------------ geometry */

describe('geometry', () => {
    it('defaults to Crop to square, with the frame at #icon-frame, aspect 1', async () => {
        await mountWithLogo();
        expect(screen.getByRole('radio', { name: /^crop to square$/i })).toBeChecked();
        const frame = document.getElementById('icon-frame');
        expect(frame).toBeInTheDocument();
        expect(frame).toHaveAttribute('data-aspect', '1');
    });

    it('names the radios icon-geometry', async () => {
        await mountWithLogo();
        for (const radio of screen.getAllByRole('radio', { name: /square$/i })) {
            expect(radio).toHaveAttribute('name', 'icon-geometry');
        }
    });

    it('removes the crop frame under Fit inside square', async () => {
        const user = userEvent.setup();
        await mountWithLogo();
        await user.click(screen.getByRole('radio', { name: /^fit inside square$/i }));
        expect(document.getElementById('icon-frame')).toBeNull();
    });

    it('shows the far-from-square note for a very wide source, regardless of which geometry is selected', async () => {
        const user = userEvent.setup();
        await mountWithLogo({ width: 1600, height: 300 });
        const note = 'This image is far from square. Crop to square keeps the part inside the frame; '
            + 'Fit inside square keeps all of it and pads the rest.';
        expect(screen.getByText(note)).toBeInTheDocument();

        await user.click(screen.getByRole('radio', { name: /^fit inside square$/i }));
        expect(screen.getByText(note)).toBeInTheDocument();
    });

    it('says nothing when the source is reasonably close to square', async () => {
        await mountWithLogo({ width: 640, height: 640 });
        expect(screen.queryByText(/far from square/i)).toBeNull();
    });
});

/* ----------------------------------------------------------- background */

describe('background', () => {
    it('defaults to Transparent, named icon-background, with the custom field id icon-background-custom', async () => {
        await mountWithLogo();
        expect(screen.getByRole('radio', { name: /^transparent$/i })).toBeChecked();
        for (const radio of screen.getAllByRole('radio', { name: /^(transparent|white|black|custom)$/i })) {
            expect(radio).toHaveAttribute('name', 'icon-background');
        }
    });

    it('shows the Apple note only while Transparent is selected', async () => {
        const user = userEvent.setup();
        await mountWithLogo();
        expect(document.getElementById('icon-apple-note')).toBeInTheDocument();
        expect(document.getElementById('icon-apple-note')).toHaveAttribute('role', 'note');
        expect(document.getElementById('icon-apple-note')).toHaveTextContent(
            'Apple’s guidelines ask for an opaque, full-bleed background and iOS masks the rounded corners '
                + 'itself, so choose a background if this icon will be added to an iPhone home screen.',
        );

        await user.click(screen.getByRole('radio', { name: /^white$/i }));
        expect(document.getElementById('icon-apple-note')).toBeNull();
    });
});

/* --------------------------------------------------------- enlargement */

describe('enlargement', () => {
    it('names the real numbers when the square source is under 512', async () => {
        await mountWithLogo({ width: 128, height: 128 });
        const note = document.getElementById('icon-enlargement');
        expect(note).toHaveTextContent(
            'Your source is 128 × 128 and will be enlarged for the 512 × 512 icon. Enlargement increases '
                + 'dimensions but cannot restore missing detail.',
        );
    });

    it('says nothing once the kept square is already 512 or larger', async () => {
        await mountWithLogo({ width: 1024, height: 1024 });
        expect(document.getElementById('icon-enlargement')).toBeNull();
    });

    /**
     * Fit inside square never enlarges a picture whose LONGER edge already
     * reaches 512: a 640 x 400 source is scaled down to 512 x 320 and padded,
     * which is what the engine's own enlargedFrom rule (the square is the
     * longer edge in contain mode) says. The frame-based reading is a cover
     * reading, and applying it here warned about the 400.
     */
    it('does not warn in Fit inside square when the longer edge reaches 512', async () => {
        const user = userEvent.setup();
        await mountWithLogo({ width: 640, height: 400 });
        expect(document.getElementById('icon-enlargement'), 'the 400 x 400 frame warns in cover mode')
            .toHaveTextContent(/your source is 400 × 400/i);

        await user.click(screen.getByRole('radio', { name: /fit inside square/i }));
        expect(document.getElementById('icon-enlargement')).toBeNull();
    });

    it('warns in Fit inside square with the whole source size when even the longer edge is short', async () => {
        const user = userEvent.setup();
        await mountWithLogo({ width: 300, height: 200 });
        await user.click(screen.getByRole('radio', { name: /fit inside square/i }));
        expect(document.getElementById('icon-enlargement')).toHaveTextContent(/your source is 300 × 200/i);
    });

    it('reads off the frame once it has been moved, not the untouched source', async () => {
        const user = userEvent.setup();
        await mountWithLogo({ width: 1024, height: 1024 });
        expect(document.getElementById('icon-enlargement')).toBeNull();

        await user.click(screen.getByRole('button', { name: /simulate drag/i }));
        // The stub reports a dragged 10x10 rect regardless of source size.
        expect(document.getElementById('icon-enlargement')).toHaveTextContent(/your source is 10 × 10/i);
    });
});

/* -------------------------------------------------------------- preview */

describe('the composed preview', () => {
    it('renders a captioned figure with a canvas, before anything is submitted', async () => {
        await mountWithLogo();
        expect(screen.getByText(
            'Preview — how the composition looks; browsers and devices draw their own frames.',
        )).toBeInTheDocument();
        expect(document.querySelector('canvas')).toBeInTheDocument();
    });

    it('offers the guide checkbox, off by default, with the small-detail sentence beneath it', async () => {
        await mountWithLogo();
        const checkbox = document.getElementById('icon-guide');
        expect(checkbox).not.toBeChecked();
        expect(screen.getByLabelText(/preview guide: circle and rounded-square masks/i)).toBe(checkbox);
        expect(screen.getByText(
            'Very small details may disappear at 16 × 16. Check the favicon preview before downloading.',
        )).toBeInTheDocument();
    });

    it('draws no guide overlay until the checkbox is checked, then draws one', async () => {
        const user = userEvent.setup();
        await mountWithLogo();
        expect(document.querySelector('svg[aria-hidden="true"] circle')).toBeNull();

        await user.click(document.getElementById('icon-guide'));
        expect(document.querySelector('svg[aria-hidden="true"] circle')).toBeInTheDocument();
        expect(document.querySelector('svg[aria-hidden="true"] rect')).toBeInTheDocument();
    });
});

describe('iconPreviewDraw (the pure geometry behind the canvas)', () => {
    it('draws the exact frame rect under cover, scaled to fill the preview', () => {
        const draw = iconPreviewDraw({
            sourceWidth: 640,
            sourceHeight: 400,
            geometry: 'cover',
            frameRect: { x: 40, y: 0, width: 400, height: 400 },
            size: 256,
        });
        expect(draw).toEqual({
            source: { x: 40, y: 0, width: 400, height: 400 },
            dest: { x: 0, y: 0, width: 256, height: 256 },
        });
    });

    it('matches fitGeometry’s own contain/pad maths for a wide source — no second geometry', () => {
        // 640x400 bound on width (640*256 >= 256*400), so height scales to 160
        // and the remaining 96px is split 48/48 top and bottom (Math.floor).
        const draw = iconPreviewDraw({
            sourceWidth: 640,
            sourceHeight: 400,
            geometry: 'contain',
            frameRect: null,
            size: 256,
        });
        expect(draw).toEqual({
            source: { x: 0, y: 0, width: 640, height: 400 },
            dest: { x: 0, y: 48, width: 256, height: 160 },
        });
    });

    it('returns null when there is nothing usable to draw', () => {
        expect(iconPreviewDraw({ sourceWidth: 0, sourceHeight: 0, geometry: 'cover', frameRect: null, size: 256 })).toBeNull();
        expect(iconPreviewDraw({ sourceWidth: 640, sourceHeight: 400, geometry: 'cover', frameRect: null, size: 256 })).toBeNull();
    });
});

/* ---------------------------------------------------- manifest fields */

describe('the manifest fields disclosure', () => {
    it('is collapsed by default, labelled, and reveals four fields plus the hint once opened', async () => {
        const user = userEvent.setup();
        await mountWithLogo();

        const button = screen.getByRole('button', { name: /web app manifest details \(optional\)/i });
        expect(button).toHaveAttribute('id', 'icon-manifest-fields');
        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(document.getElementById('icon-app-name')).not.toBeVisible();

        await user.click(button);

        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(document.getElementById('icon-app-name')).toBeVisible();
        expect(document.getElementById('icon-short-name')).toBeVisible();
        expect(document.getElementById('icon-theme-color')).toBeVisible();
        expect(document.getElementById('icon-manifest-background')).toBeVisible();
        // buildManifest keeps a colour only as #rgb or #rrggbb, so the hint
        // has to show the # — a visitor who follows a hint without it would
        // watch the colour vanish from the manifest.
        expect(document.getElementById('icon-theme-color')).toHaveAccessibleDescription(/starting with # and six digits/);
        expect(document.getElementById('icon-manifest-background')).toHaveAccessibleDescription(/starting with # and six digits/);
        expect(screen.getByText(
            'Only what you type here goes into site.webmanifest; leave a field empty to leave it out.',
        )).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------- submit */

describe('the job sent to the engine', () => {
    it('sends geometry, the crop rect and the background under Crop to square', async () => {
        const user = userEvent.setup();
        await mountWithLogo();
        await user.click(actionButton());

        expect(harness.submit).toHaveBeenCalledTimes(1);
        const [form] = harness.submit.mock.calls[0];
        expect(form.get('geometry')).toBe('cover');
        expect(form.get('background')).toBe('transparent');
        expect(form.get('crop_x')).not.toBeNull();
        expect(form.get('crop_width')).not.toBeNull();
        expect(form.get('file')).toBeTruthy();
    });

    it('sends no crop fields under Fit inside square, and the chosen background', async () => {
        const user = userEvent.setup();
        await mountWithLogo();
        await user.click(screen.getByRole('radio', { name: /^fit inside square$/i }));
        await user.click(screen.getByRole('radio', { name: /^white$/i }));
        await user.click(actionButton());

        const [form] = harness.submit.mock.calls.at(-1);
        expect(form.get('geometry')).toBe('contain');
        expect(form.get('background')).toBe('white');
        expect(form.get('crop_x')).toBeNull();
    });

    it('clears a finished result when the background changes', async () => {
        const user = userEvent.setup();
        await mountWithLogo();
        await user.click(actionButton());
        await act(async () => { harness.setResult(fakeOutcome()); });
        expect(screen.queryByRole('button', { name: /^generate icons$/i })).toBeNull();

        await user.click(screen.getByRole('radio', { name: /^black$/i }));
        expect(screen.getByRole('button', { name: /^generate icons$/i })).toBeVisible();
    });

    it('clears a finished result when a manifest field changes', async () => {
        const user = userEvent.setup();
        await mountWithLogo();
        await user.click(screen.getByRole('button', { name: /web app manifest details/i }));
        await user.click(actionButton());
        await act(async () => { harness.setResult(fakeOutcome()); });

        await user.type(document.getElementById('icon-app-name'), 'A');
        expect(screen.getByRole('button', { name: /^generate icons$/i })).toBeVisible();
    });
});

/* --------------------------------------------------------------- result */

describe('the finished result', () => {
    async function withResult(overrides = {}) {
        const view = await mountWithLogo();
        await act(async () => { harness.setResult(fakeOutcome(overrides)); });
        return view;
    }

    it('headlines "Icons ready", focused, in a section labelled by it', async () => {
        await withResult();
        const heading = screen.getByRole('heading', { name: /^icons ready$/i });
        expect(heading).toHaveAttribute('id', 'icon-result-heading');
        expect(heading.closest('section')).toHaveAttribute('aria-labelledby', 'icon-result-heading');
        await waitFor(() => expect(document.activeElement).toBe(heading));
    });

    it('stamps the result section with data-generate-ms, timed from the real Generate click', async () => {
        const user = userEvent.setup();
        await mountWithLogo();
        await user.click(actionButton());
        await act(async () => { harness.setResult(fakeOutcome()); });

        const heading = screen.getByRole('heading', { name: /^icons ready$/i });
        const stamp = heading.closest('section').getAttribute('data-generate-ms');
        expect(stamp).not.toBeNull();
        expect(Number(stamp)).toBeGreaterThanOrEqual(0);
    });

    it('previews the 16, 32, 192 and 512 PNGs at natural size inside #icon-sizes, each with its own alt', async () => {
        await withResult();
        const region = document.getElementById('icon-sizes');
        for (const size of [16, 32, 192, 512]) {
            // 16 and 32 each appear twice (natural size + the 4x check copy
            // below), so the natural-size one is picked out by its own width.
            const natural = within(region)
                .getAllByAltText(`Generated ${size} × ${size} icon`)
                .find((img) => img.getAttribute('width') === String(size));
            expect(natural).toBeTruthy();
            expect(natural).toHaveAttribute('height', String(size));
        }
    });

    it('shows the 16 and 32 a second time at 4×, captioned "enlarged to check"', async () => {
        await withResult();
        const region = document.getElementById('icon-sizes');
        const bigSixteen = within(region).getAllByAltText('Generated 16 × 16 icon').find((img) => img.getAttribute('width') === '64');
        const bigThirtyTwo = within(region).getAllByAltText('Generated 32 × 32 icon').find((img) => img.getAttribute('width') === '128');
        expect(bigSixteen).toBeTruthy();
        expect(bigThirtyTwo).toBeTruthy();
        expect(within(region).getAllByText(/enlarged to check/i)).toHaveLength(2);
    });

    it('lists every package entry in ICON_ASSETS order, with dimensions, type, bytes and a Download button', async () => {
        await withResult();
        const items = within(document.getElementById('icon-assets')).getAllByRole('listitem');
        expect(items).toHaveLength(ICON_ASSETS.length);

        const icoRow = items[0];
        expect(icoRow).toHaveTextContent('favicon.ico');
        expect(icoRow).toHaveTextContent('ICO: 16, 32, 48');
        expect(icoRow).toHaveTextContent('ICO');
        expect(within(icoRow).getByRole('button', { name: 'Download favicon.ico' })).toBeInTheDocument();

        const pngRow = items[1];
        expect(pngRow).toHaveTextContent('favicon-16x16.png');
        expect(pngRow).toHaveTextContent('16 × 16');
        expect(pngRow).toHaveTextContent('PNG');

        const manifestRow = items.at(-1);
        expect(manifestRow).toHaveTextContent('site.webmanifest');
        expect(manifestRow).toHaveTextContent('Web app manifest');
        expect(manifestRow).toHaveTextContent('JSON');
        expect(within(manifestRow).getByRole('button', { name: 'Download site.webmanifest' })).toBeInTheDocument();
    });

    it('marks a verified asset "Verified", from the checks, and does not mark a failed one', async () => {
        const unmet = await withResult({ checks: fakeChecks({ ok: false }) });
        const items = within(document.getElementById('icon-assets')).getAllByRole('listitem');
        for (const item of items.slice(0, -1)) {
            expect(item).not.toHaveTextContent('Verified');
        }
        unmet.unmount();

        await withResult();
        const verifiedItems = within(document.getElementById('icon-assets')).getAllByRole('listitem');
        expect(verifiedItems[0]).toHaveTextContent('Verified');
    });

    it('builds the ZIP from the real assets and manifest, named by ZIP_FILENAME', async () => {
        const user = userEvent.setup();
        await withResult();
        await user.click(screen.getByRole('button', { name: /^download all as zip$/i }));
        await waitFor(() => expect(screen.queryByRole('button', { name: /zipping/i })).toBeNull());
        // buildZip is real; a successful call leaves no error alert behind.
        expect(screen.queryByText(/couldn.t create the zip/i)).toBeNull();
    });

    it('shows the real HTML snippet and manifest JSON, each with its own Copy button, and one shared status region', async () => {
        const user = userEvent.setup();
        const clipboardWriteText = stubClipboard();
        await withResult();

        // `.textContent`, not toHaveTextContent: a <pre><code> block's whole
        // point is that its whitespace — the newlines between lines — is
        // significant, and jest-dom's matcher normalizes it away by default.
        expect(document.getElementById('icon-html').textContent).toBe(buildHtmlSnippet({ manifest: true }));
        expect(screen.getByText('Example HTML for these generated files.')).toBeInTheDocument();
        expect(document.getElementById('icon-manifest').textContent).toBe(buildManifest({}));

        const statusRegions = screen.getAllByRole('status');
        expect(statusRegions).toHaveLength(1);
        expect(statusRegions[0]).toHaveTextContent('');

        await user.click(screen.getByRole('button', { name: /^copy html$/i }));
        expect(clipboardWriteText).toHaveBeenCalledWith(buildHtmlSnippet({ manifest: true }));
        await waitFor(() => expect(screen.getAllByRole('status')[0]).toHaveTextContent('Copied'));
    });

    it('builds the manifest from the typed App name, Short name and colours', async () => {
        const user = userEvent.setup();
        await mountWithLogo();
        await user.click(screen.getByRole('button', { name: /web app manifest details/i }));
        await user.type(document.getElementById('icon-app-name'), 'Resizo');
        await user.type(document.getElementById('icon-theme-color'), '#c7431f');
        await user.click(actionButton());
        await act(async () => { harness.setResult(fakeOutcome()); });

        expect(document.getElementById('icon-manifest').textContent).toBe(
            buildManifest({ name: 'Resizo', themeColor: '#c7431f' }),
        );
    });
});

/* -------------------------------------------------------- stale results */

describe('changing settings after a result', () => {
    it('clears the result when the geometry changes', async () => {
        const user = userEvent.setup();
        await mountWithLogo();
        await user.click(actionButton());
        await act(async () => { harness.setResult(fakeOutcome()); });

        await user.click(screen.getByRole('radio', { name: /^fit inside square$/i }));
        expect(screen.getByRole('button', { name: /^generate icons$/i })).toBeVisible();
    });

    it('clears the result when the frame moves', async () => {
        const user = userEvent.setup();
        await mountWithLogo();
        await user.click(actionButton());
        await act(async () => { harness.setResult(fakeOutcome()); });

        await user.click(screen.getByRole('button', { name: /simulate drag/i }));
        expect(screen.getByRole('button', { name: /^generate icons$/i })).toBeVisible();
    });

    // No "picks a different file while one is already loaded" case: exactly
    // like /image-size-fitter and /passport-photo-print, the dropzone (and
    // its #icon-file id) is gone the moment a file is chosen, replaced by the
    // crop/preview area — a new file can only arrive via Choose another logo
    // or Start over, both of which already call submit.reset() as part of a
    // full reset, so there is no separate "stale result survives a file swap"
    // path to prove wrong here.
});

/* -------------------------------------------------------------- failure */

describe('a refusal', () => {
    it('shows the alert with id icon-error and focuses it', async () => {
        await mountWithLogo();
        await act(async () => {
            harness.setFailure({
                error: 'That would take more memory than this device can spare. Try a smaller logo.',
                suggestion: 'Try a smaller logo.',
                code: 'not-enough-memory',
            });
        });

        const alert = screen.getByRole('alert');
        expect(alert).toHaveAttribute('id', 'icon-error');
        await waitFor(() => expect(document.activeElement?.id).toBe('icon-error'));
    });
});

/* -------------------------------------------------------------- reset */

describe('Start over', () => {
    it('resets and focuses the browse button', async () => {
        const user = userEvent.setup();
        await mountWithLogo();
        await user.click(actionButton());
        await act(async () => { harness.setResult(fakeOutcome()); });

        await user.click(screen.getByRole('button', { name: /^start over$/i }));

        expect(document.getElementById('icon-file')).toBeInTheDocument();
        await waitFor(() => expect(document.activeElement?.id).toBe('icon-file-browse'));
    });
});
