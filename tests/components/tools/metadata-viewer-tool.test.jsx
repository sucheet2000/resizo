/**
 * /image-metadata-viewer — the read-only report, and what it is allowed to say.
 *
 * This tool never writes a file. It reads bytes with file.arrayBuffer() and
 * hands them to inspectImageMetadata on the main thread, so there is no
 * useLocalProcess and no worker here — unlike every other tool suite in this
 * folder. lib/image-client/metadata-report is mocked at its module boundary:
 * what is under test is what the page displays for a given report shape, not
 * how EXIF/GPS/XMP/ICC bytes are parsed (the engine's own suites own that).
 *
 * Three things matter most, in this order:
 *
 *  1. EVERY VALUE REACHES THE DOM AS TEXT. A report value is the visitor's own
 *     data — coordinates, a camera model, an XMP description someone else
 *     wrote — so a value containing markup must render as inert text, never as
 *     an element. This is the one negative assertion nothing else here proves.
 *  2. Sections render only when they have rows, so a plain screenshot photo
 *     does not grow eight empty headings.
 *  3. Every id and sentence is the same one the E2E flow looks for.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ inspect: null }));

vi.mock('@/lib/image-client/metadata-report', () => ({
    inspectImageMetadata: (...args) => harness.inspect(...args),
}));

import MetadataViewerTool from '@/app/(tools)/image-metadata-viewer/MetadataViewerTool';
import { formatFileSize } from '@/lib/format/bytes';
import { imageFile, setInputFiles } from '../helpers.jsx';

const SOURCE_BYTES = 2_500_000;

/** A report with every section populated — nothing here may print as an id. */
const RICH = {
    ok: true,
    file: {
        name: 'vacation.jpg',
        extension: 'jpg',
        format: 'jpeg',
        mimeType: 'image/jpeg',
        bytes: SOURCE_BYTES,
        width: 4000,
        height: 3000,
        megapixels: 12.0,
        alphaChannel: false,
        animated: false,
        extensionMismatch: false,
        expectedExtensions: ['jpg', 'jpeg', 'jpe', 'jfif'],
    },
    resolution: {
        present: true,
        x: 300,
        y: 300,
        unit: 'inch',
        source: 'exif',
        printSize: { widthIn: 13.33, heightIn: 10.0 },
        raw: {},
    },
    exif: {
        present: true,
        byteOrder: 'MM',
        fields: [
            { id: 'make', label: 'Make', value: 'Resizo' },
            { id: 'model', label: 'Model', value: 'Fixture Camera' },
            { id: 'dateTimeOriginal', label: 'Date taken', value: '2024-05-01 14:03:22' },
        ],
        orientation: { value: 6, description: 'Rotate 90° clockwise', transform: 'rotate(90deg)' },
        dates: [],
        entryCount: 12,
        problems: [],
    },
    gps: {
        present: true,
        latitude: 51.4778,
        longitude: -0.0015,
        altitude: { metres: 46, belowSeaLevel: false },
        timestamp: { date: '2024-05-01', time: '13:03:22', utc: true },
        raw: {},
        problems: [],
    },
    xmp: {
        present: true,
        bytes: 2913,
        extended: false,
        fields: [{ id: 'dc:creator', label: 'Creator', value: 'Resizo Fixtures' }],
        packet: '<x:xmpmeta>fixture</x:xmpmeta>',
        truncated: false,
    },
    icc: {
        present: true,
        bytes: 3144,
        source: 'app2',
        description: 'sRGB IEC61966-2.1',
        colourSpace: 'RGB',
        version: '2.1',
        compressed: false,
    },
    text: [
        { source: 'comment', keyword: null, value: 'Edited in Fixture Tool', truncated: false, bytes: 21, compressed: false },
    ],
    other: {
        thumbnail: true,
        iptc: false,
        mpf: false,
        trailer: false,
        trailerBytes: 0,
        pngTime: null,
        jfif: null,
        adobe: false,
    },
    privacy: {
        location: true,
        categories: [
            { id: 'location', present: true, summary: 'GPS coordinates' },
            { id: 'capture-time', present: true, summary: 'Capture date and time' },
            { id: 'device', present: true, summary: 'Camera make and model' },
            { id: 'creator', present: false, summary: 'Name or copyright' },
            { id: 'software', present: false, summary: 'Editing software' },
            { id: 'text', present: true, summary: 'Comments or descriptions' },
            { id: 'thumbnail', present: true, summary: 'Embedded preview image' },
            { id: 'extra-images', present: false, summary: 'Extra images after the picture' },
        ],
        removable: true,
    },
    problems: [],
    raw: [
        { group: 'IFD0', tag: '0x010F', name: 'Make', value: 'Resizo' },
        { group: 'Exif', tag: '0x9003', name: 'DateTimeOriginal', value: '2024:05:01 14:03:22' },
        { group: 'GPS', tag: '0x0002', name: 'GPSLatitude', value: '51/1 28/1 4020/100' },
        { group: 'XMP', tag: 'dc:creator', name: null, value: 'Resizo Fixtures' },
        { group: 'ICC', tag: 'desc', name: 'Description', value: 'sRGB IEC61966-2.1' },
    ],
};

/** A plain screenshot: nothing embedded at all. */
const EMPTY = {
    ok: true,
    file: {
        name: 'screenshot.png',
        extension: 'png',
        format: 'png',
        mimeType: 'image/png',
        bytes: 400_000,
        width: 1170,
        height: 2532,
        megapixels: 3.0,
        alphaChannel: false,
        animated: false,
        extensionMismatch: false,
        expectedExtensions: ['png'],
    },
    resolution: { present: false, x: null, y: null, unit: null, source: null, printSize: null, raw: {} },
    exif: { present: false, byteOrder: null, fields: [], orientation: { value: null, description: null, transform: null }, dates: [], entryCount: 0, problems: [] },
    gps: { present: false, latitude: null, longitude: null, altitude: null, timestamp: null, raw: {}, problems: [] },
    xmp: { present: false, bytes: 0, extended: false, fields: [], packet: null, truncated: false },
    icc: { present: false, bytes: 0, source: null, description: null, colourSpace: null, version: null, compressed: false },
    text: [],
    other: { thumbnail: false, iptc: false, mpf: false, trailer: false, trailerBytes: 0, pngTime: null, jfif: null, adobe: false },
    privacy: {
        location: false,
        categories: [
            { id: 'location', present: false, summary: 'GPS coordinates' },
            { id: 'capture-time', present: false, summary: 'Capture date and time' },
            { id: 'device', present: false, summary: 'Camera make and model' },
            { id: 'creator', present: false, summary: 'Name or copyright' },
            { id: 'software', present: false, summary: 'Editing software' },
            { id: 'text', present: false, summary: 'Comments or descriptions' },
            { id: 'thumbnail', present: false, summary: 'Embedded preview image' },
            { id: 'extra-images', present: false, summary: 'Extra images after the picture' },
        ],
        removable: false,
    },
    problems: [],
    raw: [],
};

/** A PNG carrying a name that claims it is a JPG. */
const MISMATCHED = {
    ...EMPTY,
    file: { ...EMPTY.file, name: 'photo.jpg', extension: 'jpg', format: 'png', extensionMismatch: true, expectedExtensions: ['jpg', 'jpeg', 'jpe', 'jfif'] },
};

/** A file whose EXIF block was partly unreadable. */
const WITH_PROBLEMS = {
    ...EMPTY,
    problems: ['Some EXIF fields could not be read.'],
};

/** A value long enough to trigger the 500-character truncation rule. */
const LONG_VALUE = 'a'.repeat(600);
const WITH_LONG_TEXT = {
    ...RICH,
    text: [{ source: 'comment', keyword: 'Comment', value: LONG_VALUE, truncated: false, bytes: LONG_VALUE.length, compressed: false }],
};

/** A value carrying a literal script tag — must render as text, never as markup. */
const XSS_VALUE = '<script>alert(1)</script>';
const WITH_XSS = {
    ...RICH,
    xmp: { ...RICH.xmp, fields: [{ id: 'dc:description', label: 'Description', value: XSS_VALUE }] },
};

const heicRefusal = () => ({ ok: false, code: 'unsupported', format: 'heic', message: 'HEIC photos are not read here.' });
const invalidRefusal = () => ({ ok: false, code: 'invalid', format: 'jpeg', message: 'This file is damaged and could not be read.' });

/**
 * userEvent.setup() installs its OWN navigator.clipboard stub (to back its
 * .copy()/.paste() helpers), unconditionally, as part of setup — so a mock
 * defined before that call is immediately overwritten. Defining it AFTER
 * setup() is the only ordering that survives to the click.
 */
function stubClipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    return writeText;
}

beforeEach(() => {
    harness.inspect = vi.fn(() => RICH);
});

afterEach(() => {
    vi.restoreAllMocks();
});

async function mountWithFile(file = imageFile('vacation.jpg', 'jpeg', { size: SOURCE_BYTES })) {
    const view = render(<MetadataViewerTool />);

    const input = document.getElementById('meta-file');
    setInputFiles(input, [file]);
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {});

    return view;
}

const summaryHeading = () => screen.getByRole('heading', { name: 'What this file contains' });
const errorAlert = () => screen.queryByRole('alert');

describe('intake', () => {
    it('exposes the drop zone by the ids the flow depends on', () => {
        render(<MetadataViewerTool />);

        expect(document.getElementById('meta-file')).toBeInTheDocument();
        expect(document.getElementById('meta-file-browse')).toBeInTheDocument();
    });

    it('offers the sample photo before a file is chosen', async () => {
        const user = userEvent.setup();
        const blob = new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])], { type: 'image/jpeg' });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) }));

        render(<MetadataViewerTool />);
        await user.click(screen.getByRole('button', { name: /try the sample photo/i }));

        await waitFor(() => expect(fetch).toHaveBeenCalledWith('/samples/metadata-sample.jpg'));
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        vi.unstubAllGlobals();
    });

    it('reads the whole file, not a slice of it', async () => {
        await mountWithFile();

        await waitFor(() => expect(harness.inspect).toHaveBeenCalled());
        const [bytes] = harness.inspect.mock.calls[0];
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBe(16);
    });

    it('does not exist before a file is chosen', () => {
        render(<MetadataViewerTool />);

        expect(screen.queryByRole('heading', { name: 'What this file contains' })).toBeNull();
        expect(harness.inspect).not.toHaveBeenCalled();
    });
});

describe('the summary', () => {
    it('lists format, pixels and size, then the presence rows', async () => {
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        const dl = summaryHeading().closest('section').querySelector('dl');
        const row = (term) => within(dl).getByText(term).nextElementSibling?.textContent;

        expect(row('Format')).toBe('JPEG');
        expect(row('Pixels')).toBe('4000 × 3000');
        expect(row('Size')).toBe(formatFileSize(SOURCE_BYTES));
        expect(row('EXIF')).toBe('Present');
        expect(row('XMP')).toBe('Present');
        expect(row('ICC profile')).toBe('Present');
        expect(row('Resolution')).toContain('300');
        expect(row('Alpha channel')).toBe('No');
    });

    it('marks GPS present with a text warning glyph, not colour alone', async () => {
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        const dl = summaryHeading().closest('section').querySelector('dl');
        const gpsRow = within(dl).getByText('GPS').nextElementSibling;

        expect(gpsRow.textContent).toContain('Present — location');
        expect(gpsRow.textContent).toContain('⚠');
        expect(within(gpsRow).getByText('warning', { selector: '.sr-only' })).toBeInTheDocument();
    });

    it('says Not found and Unknown for an empty file', async () => {
        harness.inspect = vi.fn(() => EMPTY);
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        const dl = summaryHeading().closest('section').querySelector('dl');
        const row = (term) => within(dl).getByText(term).nextElementSibling?.textContent;

        expect(row('EXIF')).toBe('Not found');
        expect(row('GPS')).toBe('Not found');
        expect(row('Resolution')).toBe('Not found');
        expect(row('Alpha channel')).toBe('No');
    });
});

describe('the privacy section', () => {
    it('announces detected location with its sentence', async () => {
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        expect(screen.getByRole('heading', { name: 'Location metadata detected' })).toBeInTheDocument();
        expect(screen.getByText('This image contains GPS coordinates.')).toBeInTheDocument();
        expect(screen.getByText('Metadata that may reveal information about the photo:')).toBeInTheDocument();
        expect(screen.getByText('Capture date and time')).toBeInTheDocument();
        expect(screen.getByText('Camera make and model')).toBeInTheDocument();
        expect(screen.getByText('Comments or descriptions')).toBeInTheDocument();
        expect(screen.getByText('Embedded preview image')).toBeInTheDocument();
    });

    it('says nothing was found for a clean file, with the exact sentence', async () => {
        harness.inspect = vi.fn(() => EMPTY);
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        expect(screen.getByRole('heading', { name: 'No location metadata detected' })).toBeInTheDocument();
        expect(screen.getByText('No common embedded metadata was found.')).toBeInTheDocument();
        expect(screen.queryByText('Metadata that may reveal information about the photo:')).toBeNull();
    });
});

describe('sections render only when they have rows', () => {
    it('shows every detail section for a rich file', async () => {
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        for (const heading of ['File', 'Image', 'Resolution', 'Camera and capture (EXIF)', 'Location (GPS)', 'Colour profile (ICC)', 'XMP', 'Comments and text', 'Other']) {
            expect(screen.getByRole('heading', { name: heading }), heading).toBeInTheDocument();
        }
    });

    it('omits every conditional section for a clean file, keeping File and Image', async () => {
        harness.inspect = vi.fn(() => EMPTY);
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        expect(screen.getByRole('heading', { name: 'File' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Image' })).toBeInTheDocument();

        for (const heading of ['Resolution', 'Camera and capture (EXIF)', 'Location (GPS)', 'Colour profile (ICC)', 'XMP', 'Comments and text', 'Other']) {
            expect(screen.queryByRole('heading', { name: heading }), heading).toBeNull();
        }
    });

    it('names the orientation with its stored value', async () => {
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        expect(screen.getByText('Rotate 90° clockwise (stored value 6)')).toBeInTheDocument();
    });

    it('shows the calculated print size beside the resolution and its source', async () => {
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        const resolutionSection = screen.getByRole('heading', { name: 'Resolution' }).closest('section');
        expect(within(resolutionSection).getByText('Source').nextElementSibling).toHaveTextContent('EXIF');
        expect(screen.getByText(/13\.33.*10\.00 in at 300/)).toBeInTheDocument();
    });
});

describe('warnings', () => {
    it('names the mismatch between the extension and the image data', async () => {
        harness.inspect = vi.fn(() => MISMATCHED);
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        const note = document.getElementById('meta-extension-note');
        expect(note).toBeInTheDocument();
        expect(note).toHaveTextContent(
            'The file extension does not match the image data: the name says JPG but the file is a PNG.',
        );
    });

    it('carries the problems sentence when a block could not be read', async () => {
        harness.inspect = vi.fn(() => WITH_PROBLEMS);
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        const note = document.getElementById('meta-problems');
        expect(note).toHaveTextContent('Some metadata could not be read.');
        expect(note).toHaveTextContent('Some EXIF fields could not be read.');
    });

    it('shows neither note for a clean report', async () => {
        harness.inspect = vi.fn(() => EMPTY);
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        expect(document.getElementById('meta-extension-note')).toBeNull();
        expect(document.getElementById('meta-problems')).toBeNull();
    });
});

describe('the primary action', () => {
    it('offers to remove metadata and pairs the sentence to the remover', async () => {
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        const link = screen.getByRole('link', { name: 'Remove metadata' });
        expect(link).toHaveAttribute('href', '/remove-image-metadata');
        expect(screen.getByText(/Want to remove this information\?/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Remove image metadata' })).toHaveAttribute('href', '/remove-image-metadata');
    });

    it('says there is nothing to remove for a clean file', async () => {
        harness.inspect = vi.fn(() => EMPTY);
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        expect(screen.getByText('There is nothing here for Remove Image Metadata to take out.')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Remove metadata' })).toBeNull();
    });
});

describe('the advanced disclosure', () => {
    it('is closed until pressed, and toggles aria-expanded', async () => {
        const user = userEvent.setup();
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        const button = document.getElementById('meta-advanced');
        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(button).toHaveAttribute('aria-controls', 'meta-advanced-panel');
        expect(document.getElementById('meta-advanced-panel')).toBeNull();

        await user.click(button);

        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(document.getElementById('meta-advanced-panel')).toBeInTheDocument();
        expect(within(document.getElementById('meta-advanced-panel')).getByText(/0x010F/)).toBeInTheDocument();
    });

    it('closes again on a new file', async () => {
        const user = userEvent.setup();
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());
        await user.click(document.getElementById('meta-advanced'));
        expect(document.getElementById('meta-advanced-panel')).toBeInTheDocument();

        // The panel replaces the drop zone with a file card while a report is
        // shown, so a second file has to go through the reset step first —
        // there is no live #meta-file input to redirect mid-report.
        harness.inspect = vi.fn(() => EMPTY);
        await user.click(screen.getByRole('button', { name: 'Choose another photo' }));
        const input = document.getElementById('meta-file');
        setInputFiles(input, [imageFile('other.png', 'png')]);
        await act(async () => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await act(async () => {});

        await waitFor(() => expect(screen.getByRole('heading', { name: 'What this file contains' })).toBeInTheDocument());
        expect(document.getElementById('meta-advanced-panel')).toBeNull();
        expect(document.getElementById('meta-advanced')).toHaveAttribute('aria-expanded', 'false');
    });

    it('truncates a value over 500 characters and reveals it on request, up to 20,000', async () => {
        const user = userEvent.setup();
        harness.inspect = vi.fn(() => WITH_LONG_TEXT);
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        const shown = screen.getByText(new RegExp(`^${'a'.repeat(500)}`));
        expect(shown.textContent.length).toBeLessThan(LONG_VALUE.length);

        await user.click(screen.getByRole('button', { name: 'Show full value' }));

        expect(screen.getByText(LONG_VALUE)).toBeInTheDocument();
    });
});

describe('a value never becomes markup', () => {
    it('renders a literal script tag as text, never as an element', async () => {
        harness.inspect = vi.fn(() => WITH_XSS);
        const { container } = await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        expect(container.querySelector('script')).toBeNull();
        expect(screen.getByText(XSS_VALUE)).toBeInTheDocument();
    });
});

describe('copy buttons', () => {
    it('copies the pixel size and announces it once, in one status region', async () => {
        const user = userEvent.setup();
        const clipboardWriteText = stubClipboard();
        const { container } = await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);

        await user.click(screen.getByRole('button', { name: 'Copy pixel dimensions' }));

        expect(clipboardWriteText).toHaveBeenCalledWith('4000 × 3000');
        await waitFor(() => expect(container.querySelector('[role="status"]')).toHaveTextContent('Copied'));
    });

    it('copies both coordinates together', async () => {
        const user = userEvent.setup();
        const clipboardWriteText = stubClipboard();
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        await user.click(screen.getByRole('button', { name: 'Copy coordinates' }));

        expect(clipboardWriteText).toHaveBeenCalledWith('51.4778, -0.0015');
    });

    it('copies the capture date and the camera model', async () => {
        const user = userEvent.setup();
        const clipboardWriteText = stubClipboard();
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        await user.click(screen.getByRole('button', { name: 'Copy capture date' }));
        expect(clipboardWriteText).toHaveBeenCalledWith('2024-05-01 14:03:22');

        await user.click(screen.getByRole('button', { name: 'Copy camera model' }));
        expect(clipboardWriteText).toHaveBeenCalledWith('Fixture Camera');
    });
});

describe('downloading the report', () => {
    it('builds a JSON blob without raw[] or xmp.packet, named after the file', async () => {
        const created = [];
        const originalCreate = URL.createObjectURL;
        const originalRevoke = URL.revokeObjectURL;
        URL.createObjectURL = vi.fn((blob) => {
            created.push(blob);
            return 'blob:fake';
        });
        URL.revokeObjectURL = vi.fn();

        try {
            const user = userEvent.setup();
            await mountWithFile();
            await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

            expect(screen.getByText('The report includes any location data found in the file.')).toBeInTheDocument();

            await user.click(screen.getByRole('button', { name: 'Download report (JSON)' }));

            // `created` also holds the file-preview thumbnail's object URL,
            // made from the raw File when the report first landed — find the
            // JSON blob the download button itself made, by its type.
            const jsonBlobs = created.filter((blob) => blob.type === 'application/json');
            expect(jsonBlobs).toHaveLength(1);
            const text = await jsonBlobs[0].text();
            const payload = JSON.parse(text);

            expect(payload.raw).toBeUndefined();
            expect(payload.xmp.packet).toBeUndefined();
            expect(payload.file.name).toBe('vacation.jpg');
            expect(payload.gps.latitude).toBe(51.4778);
        } finally {
            URL.createObjectURL = originalCreate;
            URL.revokeObjectURL = originalRevoke;
        }
    });
});

describe('choosing another photo', () => {
    it('resets the report and focuses the browse button', async () => {
        const user = userEvent.setup();
        await mountWithFile();
        await waitFor(() => expect(summaryHeading()).toBeInTheDocument());

        await user.click(screen.getByRole('button', { name: 'Choose another photo' }));

        expect(screen.queryByRole('heading', { name: 'What this file contains' })).toBeNull();
        expect(document.getElementById('meta-file')).toBeInTheDocument();
        await waitFor(() => expect(document.getElementById('meta-file-browse')).toHaveFocus());
    });
});

describe('focus after inspection', () => {
    it('moves focus to the summary heading', async () => {
        await mountWithFile();

        await waitFor(() => expect(summaryHeading()).toHaveFocus());
        expect(summaryHeading()).toHaveAttribute('tabIndex', '-1');
    });
});

describe('a refusal from the engine', () => {
    it('shows the HEIC message with a link to convert first', async () => {
        harness.inspect = vi.fn(heicRefusal);
        await mountWithFile();

        await waitFor(() => expect(errorAlert()).toBeInTheDocument());
        expect(document.getElementById('meta-error')).toHaveTextContent('HEIC photos are not read here.');
        const link = screen.getByRole('link', { name: /Convert it with HEIC to JPG first, then inspect the result\./ });
        expect(link).toHaveAttribute('href', '/heic');
        expect(screen.queryByRole('heading', { name: 'What this file contains' })).toBeNull();
    });

    it('shows the invalid-file message with no HEIC link', async () => {
        harness.inspect = vi.fn(invalidRefusal);
        await mountWithFile();

        await waitFor(() => expect(errorAlert()).toBeInTheDocument());
        const alert = document.getElementById('meta-error');
        expect(alert).toHaveTextContent('This file is damaged and could not be read.');
        expect(within(alert).queryByRole('link', { name: /heic/i })).toBeNull();
    });

    it('clears a refusal when a new file is chosen', async () => {
        const user = userEvent.setup();
        harness.inspect = vi.fn(invalidRefusal);
        await mountWithFile();
        await waitFor(() => expect(errorAlert()).toBeInTheDocument());

        // A refusal still shows the file card (with its own remove control),
        // never the drop zone — so back out through that, exactly as a
        // visitor would, before picking a different file.
        harness.inspect = vi.fn(() => RICH);
        await user.click(screen.getByRole('button', { name: /remove file/i }));
        const input = document.getElementById('meta-file');
        setInputFiles(input, [imageFile('vacation.jpg', 'jpeg', { size: SOURCE_BYTES })]);
        await act(async () => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await act(async () => {});

        expect(screen.queryByRole('alert')).toBeNull();
        expect(summaryHeading()).toBeInTheDocument();
    });
});

describe('what the bench and a screen reader need from a report', () => {
    it('stamps how long the parse took on the report root, for the benchmark to read', async () => {
        await mountWithFile();

        const root = document.querySelector('[data-parse-ms]');
        expect(root).not.toBeNull();
        expect(Number(root.getAttribute('data-parse-ms'))).toBeGreaterThanOrEqual(0);
    });

    it('says when the clipboard refused, instead of staying silent', async () => {
        const user = userEvent.setup();
        await mountWithFile();
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
            configurable: true,
        });

        await user.click(screen.getAllByRole('button', { name: /^Copy / })[0]);

        await waitFor(() => expect(document.querySelector('[role="status"]')).toHaveTextContent('Could not copy'));
    });
});
