/**
 * BulkConvertTool — the /bulk-image-converter panel.
 *
 * useBulkBatch is the seam and is stubbed here on purpose, the same way
 * bulk-compress-tool.test.jsx stubs useBulkCompress: the point of these tests
 * is what the page shows and calls the hook with, not what the engine
 * actually does to a byte. summarizeConversion itself is left REAL (imported
 * from the shipped lib/upload/convert-batch.js) and run over whatever `rows`
 * the stub is patched with, so a test only ever has to state the rows — never
 * a hand-typed summary object that could quietly drift from what the real
 * summariser computes.
 *
 * useImageUpload is left real, exactly as the compressor's suite leaves it.
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// canDecodeAvif() does not exist in lib/image-client/capability.js yet — a
// separate, concurrent change on this branch — and useImageUpload now calls
// it for real the moment an accept list carries 'avif', which this tool's
// does. Every other export is left real via importOriginal.
vi.mock('@/lib/image-client/capability', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, canDecodeAvif: vi.fn().mockResolvedValue(true) };
});

import BulkConvertTool from '@/app/(tools)/bulk-image-converter/BulkConvertTool';
import { CONVERT_INPUT_FORMATS } from '@/lib/limits';
import { STATUS, ZIP_FAILED_MESSAGE } from '@/lib/upload/batch';
import { DEFAULT_QUALITY } from '@/lib/upload/convert-batch';
import { disguisedFile, imageFile, setInputFiles, stubImageProbe } from '../helpers';

const harness = vi.hoisted(() => ({
    run: vi.fn(),
    retry: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
    downloadOne: vi.fn(),
    downloadZip: vi.fn(),
    setState: null,
}));

vi.mock('@/lib/hooks/useBulkBatch', async () => {
    const { useState } = await import('react');
    const { summarizeConversion } = await import('@/lib/upload/convert-batch');

    const initial = {
        rows: [],
        isProcessing: false,
        progress: 0,
        counts: { total: 0, settled: 0, current: null },
        settings: null,
        zipError: null,
        isZipping: false,
    };

    return {
        useBulkBatch: function useStubbedBulkBatch() {
            const [state, setState] = useState(initial);
            harness.setState = setState;

            return {
                ...state,
                // Real summariser, run for real over whatever rows the test
                // patched in — see the file banner for why.
                summary: summarizeConversion(state.rows),
                run: (...args) => harness.run(...args),
                retry: (...args) => harness.retry(...args),
                cancel: (...args) => harness.cancel(...args),
                reset: (...args) => harness.reset(...args),
                downloadOne: (...args) => harness.downloadOne(...args),
                downloadZip: (...args) => harness.downloadZip(...args),
            };
        },
    };
});

function successRowFor(name, overrides = {}) {
    return {
        id: name,
        name,
        folder: null,
        status: STATUS.success,
        kept: false,
        originalBytes: 1_800_000,
        resultBytes: 248 * 1024,
        width: 2400,
        height: 1600,
        sourceWidth: 2400,
        sourceHeight: 1600,
        format: 'png',
        outputFormat: 'webp',
        quality: DEFAULT_QUALITY,
        background: 'white',
        filename: name.replace(/\.png$/, '.webp'),
        error: null,
        resized: false,
        flattened: false,
        note: null,
        ...overrides,
    };
}

function keptRowFor(name, overrides = {}) {
    return successRowFor(name, {
        kept: true,
        format: 'webp',
        outputFormat: 'webp',
        resultBytes: 1_800_000,
        filename: name,
        note: 'Already WebP — kept unchanged, metadata included.',
        ...overrides,
    });
}

function failedRowFor(name, overrides = {}) {
    return {
        ...successRowFor(name),
        status: STATUS.failed,
        kept: false,
        resultBytes: null,
        width: null,
        height: null,
        filename: null,
        error: `Resizo couldn’t convert ${name} to WebP on this device.`,
        ...overrides,
    };
}

function waitingRowFor(name, overrides = {}) {
    return { ...successRowFor(name), status: STATUS.waiting, resultBytes: null, width: null, height: null, filename: null, note: null, ...overrides };
}

function processingRowFor(name, overrides = {}) {
    return { ...waitingRowFor(name), status: STATUS.processing, ...overrides };
}

function patchState(patch) {
    harness.setState((current) => ({ ...current, ...patch }));
}

let probe;

beforeEach(() => {
    probe = stubImageProbe({ width: 2400, height: 1600 });
    harness.run.mockClear();
    harness.retry.mockClear();
    harness.cancel.mockClear();
    harness.reset.mockClear();
    harness.downloadOne.mockClear();
    harness.downloadZip.mockClear();
});

afterEach(() => {
    probe.restore();
});

async function uploadFiles(files) {
    const input = document.getElementById('bulk-convert-file');
    setInputFiles(input, files);
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function chip(label) {
    return screen.getByRole('button', { name: new RegExp(`^${label}$`) });
}

describe('the page frame', () => {
    it('renders the required H1', () => {
        render(<BulkConvertTool />);
        expect(screen.getByRole('heading', { level: 1, name: 'Convert Many Images to One Format' })).toBeInTheDocument();
    });

    it('renders the dropzone with the contract id and browse button id', () => {
        render(<BulkConvertTool />);
        expect(document.getElementById('bulk-convert-file')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Choose images' })).toHaveAttribute('id', 'bulk-convert-file-browse');
    });

    it('relabels the browse button once files are queued', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.jpg')]);
        expect(screen.getByRole('button', { name: 'Add more images' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Choose images' })).toBeNull();
    });
});

describe('the output-format chips', () => {
    it('offers JPG, PNG and WebP, WebP active by default', () => {
        render(<BulkConvertTool />);
        const group = screen.getByRole('group', { name: 'Output format' });
        for (const label of ['JPG', 'PNG', 'WebP']) {
            expect(within(group).getByRole('button', { name: label })).toBeInTheDocument();
        }
        expect(chip('WebP')).toHaveAttribute('aria-pressed', 'true');
        expect(chip('JPG')).toHaveAttribute('aria-pressed', 'false');
    });

    it('switches the active chip on click and never deselects to none', async () => {
        const user = userEvent.setup();
        render(<BulkConvertTool />);

        await user.click(chip('PNG'));
        expect(chip('PNG')).toHaveAttribute('aria-pressed', 'true');
        expect(chip('WebP')).toHaveAttribute('aria-pressed', 'false');

        // Clicking the already-active chip must not leave zero formats selected.
        await user.click(chip('PNG'));
        expect(chip('PNG')).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows the Quality slider for WebP and JPG, and the lossless sentence for PNG', async () => {
        const user = userEvent.setup();
        render(<BulkConvertTool />);

        expect(screen.getByRole('slider', { name: /Quality/ })).toBeInTheDocument();
        expect(screen.queryByText('PNG is lossless — there is no quality setting.')).toBeNull();

        await user.click(chip('PNG'));
        expect(screen.queryByRole('slider')).toBeNull();
        expect(screen.getByText('PNG is lossless — there is no quality setting.')).toBeInTheDocument();

        await user.click(chip('JPG'));
        expect(screen.getByRole('slider', { name: /Quality/ })).toBeInTheDocument();
    });

    it('has the quality slider default to 80 and update its own accessible name as it moves', async () => {
        render(<BulkConvertTool />);
        const slider = screen.getByRole('slider', { name: 'Quality 80' });
        expect(slider).toHaveAttribute('min', '1');
        expect(slider).toHaveAttribute('max', '100');
        expect(slider).toHaveValue('80');

        fireQualityChange(slider, 55);
        expect(screen.getByRole('slider', { name: 'Quality 55' })).toBeInTheDocument();
    });
});

function fireQualityChange(slider, value) {
    // jsdom range inputs need a native value setter to notify React.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(slider, String(value));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * AVIF is a bulk INPUT only — the engine agent's plan is explicit that a
 * batch of phone-side AVIF encodes is not proven safe under the 20-file /
 * 80 MB model, so the accepted set widens (this tool takes CONVERT_INPUT_FORMATS
 * now, not the narrower RASTER_INPUT_FORMATS every other bulk tool uses) while
 * the output chips do not. The note pointing at /convert only has something
 * true to say once AVIF is actually an accepted input, so it is gated on the
 * registry rather than always shown.
 */
describe('AVIF — accepted as input, not offered as output', () => {
    it('accepts an AVIF file, now that CONVERT_INPUT_FORMATS carries it', async () => {
        expect(CONVERT_INPUT_FORMATS, 'this test has nothing to prove once the registry moves on').toContain('avif');

        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.avif', 'avif')]);

        expect(screen.getByRole('button', { name: /^Convert 1 image$/ })).toBeEnabled();
        expect(screen.queryByText(/not a .*image/i)).toBeNull();
    });

    it('lists AVIF in the drop zone’s accept attribute', () => {
        render(<BulkConvertTool />);
        const input = document.getElementById('bulk-convert-file');

        expect(input.accept).toContain('image/avif');
    });

    it('says AVIF output is on /convert, linked, once AVIF is an accepted input', () => {
        render(<BulkConvertTool />);
        const link = screen.getByRole('link', { name: 'single-image converter' });

        expect(link).toHaveAttribute('href', '/convert');
    });

});

describe('the transparency background control', () => {
    it('stays hidden for a batch of only JPEGs converting to JPG', async () => {
        const user = userEvent.setup();
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.jpg', 'jpeg')]);
        await user.click(chip('JPG'));

        expect(screen.queryByText('Transparent areas become')).toBeNull();
        expect(screen.queryByText('Transparent areas become')).toBeNull();
    });

    it('appears for JPG once a PNG (alpha-capable) file is in the batch', async () => {
        const user = userEvent.setup();
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.png', 'png')]);
        await user.click(chip('JPG'));

        expect(screen.getByText('Transparent areas become')).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /White/ })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Custom' })).toBeInTheDocument();
    });

    it('appears for JPG for a WebP source too, and disappears again for a non-JPG output', async () => {
        const user = userEvent.setup();
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.webp', 'webp')]);
        await user.click(chip('JPG'));
        expect(screen.getByText('Transparent areas become')).toBeInTheDocument();

        await user.click(chip('WebP'));
        expect(screen.queryByText('Transparent areas become')).toBeNull();
    });
});

describe('the action', () => {
    it('is disabled with a hint until at least one image is queued', () => {
        render(<BulkConvertTool />);
        const button = screen.getByRole('button', { name: /^Convert 0 images$/ });
        expect(button).toBeDisabled();
        expect(screen.getByText('Add images to turn this on.')).toBeInTheDocument();
    });

    it('counts the queued images, singular and plural', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.jpg')]);
        expect(screen.getByRole('button', { name: /^Convert 1 image$/ })).toBeEnabled();

        await uploadFiles([imageFile('b.jpg', 'png')]);
        expect(screen.getByRole('button', { name: /^Convert 2 images$/ })).toBeEnabled();
    });

    it('calls run with the format, quality and background currently on screen', async () => {
        const user = userEvent.setup();
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.png', 'png')]);
        await user.click(chip('JPG'));
        await user.click(screen.getByRole('radio', { name: 'Black' }));

        await user.click(screen.getByRole('button', { name: /^Convert 1 image$/ }));

        expect(harness.run).toHaveBeenCalledTimes(1);
        const [items, options] = harness.run.mock.calls[0];
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ name: 'a.png', sourceWidth: 2400, sourceHeight: 1600, format: 'png' });
        expect(options).toEqual({ outputFormat: 'jpeg', quality: DEFAULT_QUALITY, background: 'black' });
    });
});

describe('unsupported and oversized intake', () => {
    it('bounces a non-image file into the Results list without blocking the good ones', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('good.jpg'), disguisedFile('notes.txt')]);

        expect(screen.getByRole('button', { name: /^Convert 1 image$/ })).toBeInTheDocument();

        const row = screen.getByText('notes.txt').closest('li');
        expect(row).toHaveAttribute('data-status', 'unsupported');
        // The exact joiner is CONVERT_INPUT_FORMATS's own prose (now four
        // formats, so "png or webp" is no longer contiguous) — matched loosely
        // here so this assertion does not itself re-type the registry.
        expect(within(row).getByText(/not a .*image\. pick one of those formats/i)).toBeInTheDocument();
    });

    it('bounces an oversized file as too large for this device', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('huge.jpg', 'jpeg', { size: 21 * 1024 * 1024 })]);

        const row = screen.getByText('huge.jpg').closest('li');
        expect(row).toHaveAttribute('data-status', 'unsafe');
        expect(within(row).getByText('Too large for this device')).toBeInTheDocument();
    });

    it('points a HEIC file at the converter instead of calling it unsupported and stopping there', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('good.jpg'), disguisedFile('holiday.heic')]);

        const row = document.querySelector('ul[aria-label="Results"] li[data-name="holiday.heic"]');
        expect(row).not.toBeNull();
        expect(row.dataset.status).toBe('unsupported');
        expect(row.textContent).toMatch(/HEIC/);
        expect(row.textContent).toMatch(/\/heic\b/);
    });

    it('never sends a rejected file to run()', async () => {
        const user = userEvent.setup();
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('good.jpg'), disguisedFile('notes.txt')]);

        await user.click(screen.getByRole('button', { name: /^Convert 1 image$/ }));

        const [items] = harness.run.mock.calls[0];
        expect(items.map((item) => item.name)).toEqual(['good.jpg']);
    });
});

describe('rows show input and output cells', () => {
    it('shows the input triple immediately, and an em dash for output before the row settles', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.png', 'png')]);

        await act(async () => {
            patchState({
                settings: { outputFormat: 'webp', quality: DEFAULT_QUALITY, background: 'white' },
                isProcessing: true,
                rows: [processingRowFor('a.png')],
                counts: { total: 1, settled: 0, current: 'a.png' },
            });
        });

        expect(document.querySelector('[data-field="input"]')).toHaveTextContent('PNG · 1.72 MB · 2400 × 1600');
        expect(document.querySelector('[data-field="output"]')).toHaveTextContent('—');
    });

    it('fills in the real output triple once a conversion succeeds', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.png', 'png')]);

        await act(async () => {
            patchState({
                settings: { outputFormat: 'webp', quality: DEFAULT_QUALITY, background: 'white' },
                rows: [successRowFor('a.png')],
            });
        });

        expect(document.querySelector('[data-field="output"]')).toHaveTextContent('WebP · 248 KB · 2400 × 1600');
        // Scoped to the row: the Batch summary that also rendered (settings is
        // now set) carries its own "Converted" dt, which would otherwise match too.
        const row = document.querySelector('li[data-name="a.png"]');
        expect(within(row).getByText('Converted')).toBeInTheDocument();
    });

    it('labels a kept row "Already in format" and shows its note, still with a download button', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.webp', 'webp')]);

        await act(async () => {
            patchState({
                settings: { outputFormat: 'webp', quality: DEFAULT_QUALITY, background: 'white' },
                rows: [keptRowFor('a.webp')],
            });
        });

        const row = document.querySelector('li[data-name="a.webp"]');
        expect(within(row).getByText('Already in format')).toBeInTheDocument();
        expect(within(row).getByText('Already WebP — kept unchanged, metadata included.')).toBeInTheDocument();
        expect(within(row).getByRole('button', { name: 'Download a.webp' })).toBeInTheDocument();
    });

    it('labels a flattened row with its background note', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.png', 'png')]);

        await act(async () => {
            patchState({
                settings: { outputFormat: 'jpeg', quality: DEFAULT_QUALITY, background: 'black' },
                rows: [successRowFor('a.png', {
                    outputFormat: 'jpeg', flattened: true, background: 'black', filename: 'a.jpg',
                    note: 'Transparent areas were placed on black.',
                })],
            });
        });

        expect(screen.getByText('Transparent areas were placed on black.')).toBeInTheDocument();
    });

    it('labels a failed row "Could not convert" with its sentence and no download button', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.png', 'png')]);

        await act(async () => {
            patchState({
                settings: { outputFormat: 'webp', quality: DEFAULT_QUALITY, background: 'white' },
                rows: [failedRowFor('a.png')],
            });
        });

        const row = document.querySelector('li[data-name="a.png"]');
        expect(within(row).getByText('Could not convert')).toBeInTheDocument();
        expect(within(row).getByText('Resizo couldn’t convert a.png to WebP on this device.')).toBeInTheDocument();
        expect(within(row).queryByRole('button', { name: /download/i })).toBeNull();
    });

    it('shows no input/output cells for a rejected (intake-bounced) row', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([disguisedFile('notes.txt')]);

        const row = screen.getByText('notes.txt').closest('li');
        expect(within(row).queryByText('Input')).toBeNull();
        expect(document.querySelector('li[data-name="notes.txt"] [data-field="input"]')).toBeNull();
    });
});

describe('while a batch is running', () => {
    it('shows a live progress line naming the current file', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.jpg'), imageFile('b.jpg')]);

        await act(async () => {
            patchState({
                isProcessing: true,
                rows: [waitingRowFor('a.jpg'), processingRowFor('b.jpg')],
                counts: { total: 2, settled: 0, current: 'b.jpg' },
            });
        });

        expect(screen.getByText('0 of 2 done · Converting b.jpg')).toBeInTheDocument();
    });

    it('switches to the completed sentence, counting CONVERTED rather than every success', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.jpg'), imageFile('b.jpg')]);

        await act(async () => {
            patchState({
                settings: { outputFormat: 'webp', quality: DEFAULT_QUALITY, background: 'white' },
                isProcessing: false,
                rows: [successRowFor('a.jpg'), keptRowFor('b.jpg')],
            });
        });

        // Two successes, but only one was an actual conversion.
        expect(screen.getByText('1 of 2 converted')).toBeInTheDocument();
    });

    it('shows a Stop button that calls cancel, and hides once processing ends', async () => {
        const user = userEvent.setup();
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.jpg')]);

        await act(async () => {
            patchState({ isProcessing: true, rows: [processingRowFor('a.jpg')], counts: { total: 1, settled: 0, current: 'a.jpg' } });
        });

        await user.click(screen.getByRole('button', { name: 'Stop' }));
        expect(harness.cancel).toHaveBeenCalledTimes(1);

        await act(async () => {
            patchState({ isProcessing: false, rows: [successRowFor('a.jpg')] });
        });
        expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    });

    it('moves focus to the Batch summary heading once the run ends', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.jpg')]);

        await act(async () => {
            patchState({ isProcessing: true, rows: [processingRowFor('a.jpg')], counts: { total: 1, settled: 0, current: 'a.jpg' } });
        });
        await act(async () => {
            patchState({
                settings: { outputFormat: 'webp', quality: DEFAULT_QUALITY, background: 'white' },
                isProcessing: false,
                rows: [successRowFor('a.jpg')],
            });
        });

        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Batch summary' }));
    });

    it('disables the format chips and the quality slider so a change cannot land mid-run', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.jpg')]);

        await act(async () => {
            patchState({ isProcessing: true, rows: [processingRowFor('a.jpg')], counts: { total: 1, settled: 0, current: 'a.jpg' } });
        });

        expect(chip('WebP')).toBeDisabled();
        expect(screen.getByRole('slider', { name: /Quality/ })).toBeDisabled();
    });
});

describe('the Batch summary', () => {
    async function withOneConvertedOneKeptOneFailed() {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.png', 'png'), imageFile('b.webp', 'webp'), imageFile('c.png', 'png')]);
        await act(async () => {
            patchState({
                settings: { outputFormat: 'webp', quality: DEFAULT_QUALITY, background: 'white' },
                isProcessing: false,
                rows: [
                    successRowFor('a.png', { originalBytes: 1000, resultBytes: 700 }),
                    keptRowFor('b.webp', { originalBytes: 500, resultBytes: 500 }),
                    failedRowFor('c.png'),
                ],
            });
        });
    }

    it('shows every dt named in the contract', async () => {
        await withOneConvertedOneKeptOneFailed();
        const summary = screen.getByRole('heading', { name: 'Batch summary' }).closest('section');

        for (const [dt, value] of [
            ['Selected', '3'],
            ['Converted', '1'],
            ['Already in format', '1'],
            ['Could not convert', '1'],
            ['Unsupported', '0'],
            ['Too large for this device', '0'],
            ['Cancelled', '0'],
        ]) {
            expect(within(summary).getByText(dt).nextElementSibling).toHaveTextContent(value);
        }
    });

    it('shows Input total, Output total and a signed Difference', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.png', 'png')]);
        await act(async () => {
            patchState({
                settings: { outputFormat: 'webp', quality: DEFAULT_QUALITY, background: 'white' },
                rows: [successRowFor('a.png', { originalBytes: 1_000_000, resultBytes: 3_400_000 })],
            });
        });

        const summary = screen.getByRole('heading', { name: 'Batch summary' }).closest('section');
        expect(within(summary).getByText('Input total').nextElementSibling).toHaveTextContent('976.56 KB');
        expect(within(summary).getByText('Output total').nextElementSibling).toHaveTextContent('3.24 MB');
        // A batch that GREW gets a real plus sign, never a minus.
        const difference = within(summary).getByText('Difference').nextElementSibling;
        expect(difference).toHaveTextContent('+2.29 MB');
        expect(difference.textContent).not.toMatch(/^-|−/);
    });

    it('shows a negative Difference with the real minus sign when the batch shrank', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.png', 'png')]);
        await act(async () => {
            patchState({
                settings: { outputFormat: 'webp', quality: DEFAULT_QUALITY, background: 'white' },
                rows: [successRowFor('a.png', { originalBytes: 2_000_000, resultBytes: 500_000 })],
            });
        });

        const difference = within(screen.getByRole('heading', { name: 'Batch summary' }).closest('section'))
            .getByText('Difference').nextElementSibling;
        expect(difference.textContent.startsWith('−')).toBe(true);
        expect(difference.textContent).not.toContain('-');
    });

    it('shows Download all as ZIP counting converted + kept, and wires it to downloadZip', async () => {
        const user = userEvent.setup();
        await withOneConvertedOneKeptOneFailed();

        const zip = screen.getByRole('button', { name: 'Download all as ZIP (2)' });
        await user.click(zip);
        expect(harness.downloadZip).toHaveBeenCalledTimes(1);
    });

    it('shows Retry failed counting only the retryable row', async () => {
        const user = userEvent.setup();
        await withOneConvertedOneKeptOneFailed();

        const retry = screen.getByRole('button', { name: 'Retry failed (1)' });
        await user.click(retry);
        expect(harness.retry).toHaveBeenCalledTimes(1);
    });

    it('shows the ZIP failure as an alert', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.png', 'png')]);
        await act(async () => {
            patchState({
                settings: { outputFormat: 'webp', quality: DEFAULT_QUALITY, background: 'white' },
                rows: [successRowFor('a.png')],
                zipError: ZIP_FAILED_MESSAGE,
            });
        });

        expect(screen.getByRole('alert')).toHaveTextContent(ZIP_FAILED_MESSAGE);
    });

    it('Start over clears the hook, the upload queue and any rejected rows', async () => {
        const user = userEvent.setup();
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('good.jpg'), disguisedFile('notes.txt')]);

        await user.click(screen.getByRole('button', { name: 'Start over' }));

        expect(harness.reset).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('notes.txt')).toBeNull();
        expect(screen.getByRole('button', { name: /^Convert 0 images$/ })).toBeInTheDocument();
    });
});

describe('focus management', () => {
    it('moves focus to the browse button after removing a selected file', async () => {
        const user = userEvent.setup();
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.jpg')]);

        await user.click(screen.getByRole('button', { name: 'Remove: a.jpg' }));

        expect(document.activeElement).toBe(document.getElementById('bulk-convert-file-browse'));
    });

    it('moves focus to the browse button after Start over', async () => {
        const user = userEvent.setup();
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('good.jpg'), disguisedFile('notes.txt')]);

        await user.click(screen.getByRole('button', { name: 'Start over' }));

        expect(document.activeElement).toBe(document.getElementById('bulk-convert-file-browse'));
    });
});

describe('the live region mounts from the first render', () => {
    it('is present and empty before any run', () => {
        render(<BulkConvertTool />);
        const status = document.querySelector('p[role="status"][aria-live="polite"][aria-atomic="true"]');
        expect(status).toBeInTheDocument();
        expect(status).toHaveTextContent('');
    });
});

describe('changing the selection after a run', () => {
    async function runOnce() {
        const user = userEvent.setup();
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.jpg')]);
        await user.click(screen.getByRole('button', { name: /^Convert 1 image$/ }));

        const [items] = harness.run.mock.calls.at(-1);
        await act(async () => {
            patchState({
                settings: { outputFormat: 'webp', quality: DEFAULT_QUALITY, background: 'white' },
                rows: [successRowFor('a.jpg', { id: items[0].id })],
            });
        });
    }

    it('no longer offers to remove a card once a run has happened — Start over is the only way', async () => {
        await runOnce();

        expect(screen.queryByRole('button', { name: /^Remove:/ })).toBeNull();
        expect(screen.getByText('To take a file out after a run, press Start over.')).toBeInTheDocument();
    });

    it('gives a file added after a run its own waiting row, placed after the hook rows and before any rejections', async () => {
        await runOnce();
        await uploadFiles([imageFile('b.jpg', 'png'), disguisedFile('notes.txt')]);

        const rows = within(screen.getByRole('list', { name: 'Results' })).getAllByRole('listitem');
        expect(rows.map((row) => row.dataset.name)).toEqual(['a.jpg', 'b.jpg', 'notes.txt']);
        expect(rows[1]).toHaveAttribute('data-status', 'waiting');
        expect(within(rows[1]).getByText('Waiting')).toBeInTheDocument();
        expect(within(rows[1]).queryByRole('button', { name: /download/i })).toBeNull();
    });
});

describe('stale results', () => {
    it('flags results made with a previous format and switches the action to "Convert again"', async () => {
        const user = userEvent.setup();
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.jpg')]);
        await user.click(screen.getByRole('button', { name: /^Convert 1 image$/ }));

        await act(async () => {
            patchState({
                settings: { outputFormat: 'webp', quality: DEFAULT_QUALITY, background: 'white' },
                rows: [successRowFor('a.jpg')],
            });
        });

        expect(screen.queryByText(/press convert again to apply your new settings/i)).toBeNull();

        await user.click(chip('PNG'));

        const stale = screen.getByText(/press convert again to apply your new settings/i);
        expect(stale).toHaveTextContent(
            'These results were made as WebP with the previous settings. Press Convert again to apply your new settings.',
        );
        expect(screen.getByRole('button', { name: /^Convert again$/ })).toBeInTheDocument();
    });

    it('flags a changed selection with its own message', async () => {
        const user = userEvent.setup();
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.jpg')]);
        await user.click(screen.getByRole('button', { name: /^Convert 1 image$/ }));
        const [items] = harness.run.mock.calls.at(-1);

        await act(async () => {
            patchState({
                settings: { outputFormat: 'webp', quality: DEFAULT_QUALITY, background: 'white' },
                rows: [successRowFor('a.jpg', { id: items[0].id })],
            });
        });

        await uploadFiles([imageFile('b.jpg', 'png')]);

        const stale = screen.getByText(/you changed the selection since the last run/i);
        expect(stale).toHaveTextContent('You changed the selection since the last run. Press Convert again to apply it.');
    });

    it('names a mix of settings across rows instead of claiming one for every row', async () => {
        const user = userEvent.setup();
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.jpg'), imageFile('b.jpg')]);
        await user.click(screen.getByRole('button', { name: /^Convert 2 images$/ }));

        await act(async () => {
            patchState({
                settings: { outputFormat: 'webp', quality: DEFAULT_QUALITY, background: 'white' },
                rows: [
                    successRowFor('a.jpg', { outputFormat: 'webp' }),
                    successRowFor('b.jpg', { outputFormat: 'jpeg' }),
                ],
            });
        });

        const stale = screen.getByText(/more than one setting/i);
        expect(stale).toHaveTextContent(
            'These results were made with more than one setting — each row states its own format. '
            + 'Press Convert again to redo them all with the current settings.',
        );
    });
});

describe('one run with mixed sources is not a mixed-settings run', () => {
    it('shows no stale notice when a kept row and a flattened row came from the same settings', async () => {
        const user = userEvent.setup();
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('photo.jpg'), imageFile('logo.png')]);
        await user.click(chip('JPG'));
        await user.click(screen.getByRole('button', { name: 'Convert 2 images' }));
        const [items, options] = harness.run.mock.calls.at(-1);

        act(() => {
            patchState({
                isProcessing: false,
                settings: options,
                rows: [
                    keptRowFor('photo.jpg', { id: items[0].id, ...options, flattenedOn: null }),
                    successRowFor('logo.png', { id: items[1].id, ...options, flattened: true, flattenedOn: options.background, note: 'Transparent areas were placed on white.' }),
                ],
            });
        });

        expect(screen.queryByText(/more than one setting/i)).toBeNull();
        expect(document.querySelector('[data-stale]')).toBeNull();
    });
});

describe('focus while a run is in progress', () => {
    it('lands on Stop the moment a run starts, because the disabled action would drop it to the body', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('photo.jpg')]);
        act(() => {
            patchState({ isProcessing: true, rows: [processingRowFor('photo.jpg')] });
        });

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stop' }));
    });
});

describe('a stale notice names the archive it leaves behind', () => {
    it('says the ZIP still holds the previous results', async () => {
        render(<BulkConvertTool />);
        await uploadFiles([imageFile('a.jpg')]);
        act(() => {
            patchState({
                isProcessing: false,
                settings: { outputFormat: "png", quality: DEFAULT_QUALITY, background: "white" },
                rows: [successRowFor('a.jpg')],
            });
        });

        expect(document.querySelector('[data-stale]')).toHaveTextContent('The ZIP still holds the previous results.');
    });
});

