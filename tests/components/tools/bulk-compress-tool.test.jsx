/**
 * BulkCompressTool — the /bulk-image-compressor panel.
 *
 * useBulkCompress is the seam and is stubbed here on purpose, the same way
 * compress-tool.test.jsx stubs useLocalProcess: the point of these tests is
 * what the page shows and calls the hook with, not what the engine actually
 * does to a byte. The stub carries real React state so a test can push the
 * hook through waiting -> processing -> settled exactly as a real run would,
 * and assert what the panel does at each step.
 *
 * useImageUpload is left real. Intake — accepting a good file, bouncing a bad
 * one, reading its size and dimensions — is the one thing this suite can prove
 * against the actual hook rather than a story about it.
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BulkCompressTool from '@/app/(tools)/bulk-image-compressor/BulkCompressTool';
import { STATUS, ZIP_FAILED_MESSAGE } from '@/lib/upload/compress-batch';
import { disguisedFile, imageFile, setInputFiles, stubImageProbe } from '../helpers';

const EMPTY_SUMMARY = {
    selected: 0,
    successful: 0,
    unmet: 0,
    unsupported: 0,
    unsafe: 0,
    cancelled: 0,
    waiting: 0,
    processing: 0,
    inputBytes: 0,
    outputBytes: 0,
    savedBytes: 0,
    reductionPercent: null,
};

const harness = vi.hoisted(() => ({
    run: vi.fn(),
    retry: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
    downloadOne: vi.fn(),
    downloadZip: vi.fn(),
    setState: null,
}));

vi.mock('@/lib/hooks/useBulkCompress', async () => {
    const { useState } = await import('react');

    const initial = {
        rows: [],
        summary: {
            selected: 0,
            successful: 0,
            unmet: 0,
            unsupported: 0,
            unsafe: 0,
            cancelled: 0,
            waiting: 0,
            processing: 0,
            inputBytes: 0,
            outputBytes: 0,
            savedBytes: 0,
            reductionPercent: null,
        },
        isProcessing: false,
        progress: 0,
        counts: { total: 0, settled: 0, current: null },
        settings: null,
        zipError: null,
        isZipping: false,
    };

    return {
        default: function useStubbedBulkCompress() {
            const [state, setState] = useState(initial);
            harness.setState = setState;

            return {
                ...state,
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
        originalBytes: 500 * 1024,
        resultBytes: 190 * 1024,
        width: 1600,
        height: 1067,
        sourceWidth: 1600,
        sourceHeight: 1067,
        format: 'jpeg',
        targetBytes: 200 * 1024,
        mode: 'preserve',
        filename: name.replace(/\.jpg$/, '-compressed.jpg'),
        error: null,
        resized: false,
        ...overrides,
    };
}

function unmetRowFor(name, overrides = {}) {
    return {
        ...successRowFor(name),
        status: STATUS.unmet,
        resultBytes: 210 * 1024,
        filename: null,
        error: `Resizo couldn’t reduce ${name} below 200 KB without changing its dimensions.`,
        ...overrides,
    };
}

function waitingRowFor(name) {
    return { ...successRowFor(name), status: STATUS.waiting, resultBytes: null, width: null, height: null, filename: null };
}

function processingRowFor(name) {
    return { ...waitingRowFor(name), status: STATUS.processing };
}

/** Merges `patch` into the stubbed hook's state, the way the real hook merges a status update. */
function patchState(patch) {
    harness.setState((current) => ({ ...current, ...patch }));
}

let probe;

beforeEach(() => {
    probe = stubImageProbe({ width: 1600, height: 1067 });
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
    const input = document.getElementById('bulk-compress-file');
    setInputFiles(input, files);
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function limitInput() {
    return screen.getByRole('spinbutton', { name: 'Custom limit (KB)' });
}

function chip(label) {
    return screen.getByRole('button', { name: new RegExp(`^${label}$`) });
}

describe('the page frame', () => {
    it('renders the required H1', () => {
        render(<BulkCompressTool />);
        expect(screen.getByRole('heading', { level: 1, name: 'Compress Many Images to a Maximum File Size' })).toBeInTheDocument();
    });

    it('renders the dropzone with the contract id and browse button id', () => {
        render(<BulkCompressTool />);
        expect(document.getElementById('bulk-compress-file')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Choose images' })).toHaveAttribute('id', 'bulk-compress-file-browse');
    });

    it('relabels the browse button once files are queued', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);
        expect(screen.getByRole('button', { name: 'Add more images' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Choose images' })).toBeNull();
    });

    it('bounds each selected-file card so a long filename cannot widen the page', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);

        const card = screen.getByText('a.jpg').closest('li');
        expect(card).toHaveClass('min-w-0', 'max-w-full');
    });
});

describe('the maximum-size controls', () => {
    it('offers the five preset chips with 200 KB active by default', () => {
        render(<BulkCompressTool />);
        const group = screen.getByRole('group', { name: 'Maximum size per image' });
        for (const label of ['50 KB', '100 KB', '200 KB', '500 KB', '1 MB']) {
            expect(within(group).getByRole('button', { name: label })).toBeInTheDocument();
        }
        expect(chip('200 KB')).toHaveAttribute('aria-pressed', 'true');
    });

    it('has the custom KB field, defaulted to the same 200', () => {
        render(<BulkCompressTool />);
        const input = limitInput();
        expect(input).toHaveAttribute('id', 'bulk-compress-limit');
        expect(input).toHaveAttribute('type', 'number');
        expect(input).toHaveAttribute('min', '10');
        expect(input).toHaveAttribute('max', '20480');
        expect(input).toHaveValue(200);
    });

    it('selecting a chip fills the custom field and marks that chip active', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);

        await user.click(chip('500 KB'));

        expect(limitInput()).toHaveValue(500);
        expect(chip('500 KB')).toHaveAttribute('aria-pressed', 'true');
        expect(chip('200 KB')).toHaveAttribute('aria-pressed', 'false');
    });

    it('typing a custom value deselects every chip', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);

        await user.clear(limitInput());
        await user.type(limitInput(), '350');

        for (const label of ['50 KB', '100 KB', '200 KB', '500 KB', '1 MB']) {
            expect(chip(label)).toHaveAttribute('aria-pressed', 'false');
        }
    });

    it('rejects a value under the minimum with an inline error, aria-invalid, and disables the action', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);

        await user.clear(limitInput());
        await user.type(limitInput(), '5');

        expect(limitInput()).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByText(/enter a whole number of kb between/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Compress 1 image$/ })).toBeDisabled();
    });

    it('accepts the value back and re-enables the action once it is valid again', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);

        await user.clear(limitInput());
        await user.type(limitInput(), '5');
        expect(screen.getByRole('button', { name: /^Compress 1 image$/ })).toBeDisabled();

        await user.clear(limitInput());
        await user.type(limitInput(), '150');

        expect(limitInput()).not.toHaveAttribute('aria-invalid');
        expect(screen.getByRole('button', { name: /^Compress 1 image$/ })).toBeEnabled();
    });
});

describe('the policy radios', () => {
    it('names both modes under the one group, Preserve dimensions checked by default', () => {
        render(<BulkCompressTool />);
        const preserve = screen.getByRole('radio', { name: 'Preserve dimensions' });
        const fit = screen.getByRole('radio', { name: 'Fit under limit' });

        expect(preserve).toBeChecked();
        expect(fit).not.toBeChecked();
        expect(preserve).toHaveAttribute('name', 'bulk-compress-mode');
        expect(fit).toHaveAttribute('name', 'bulk-compress-mode');
    });

    it('states each mode’s own hint, verbatim', () => {
        render(<BulkCompressTool />);
        expect(screen.getByText(
            'Quality only. A file that can’t get under the limit at its size is reported, never resized.',
        )).toBeInTheDocument();
        expect(screen.getByText(
            'Quality first, then a smaller picture with the same shape, down to the smallest size Resizo allows.',
        )).toBeInTheDocument();
    });

    it('switches on click', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);

        await user.click(screen.getByRole('radio', { name: 'Fit under limit' }));

        expect(screen.getByRole('radio', { name: 'Fit under limit' })).toBeChecked();
        expect(screen.getByRole('radio', { name: 'Preserve dimensions' })).not.toBeChecked();
    });
});

describe('the action', () => {
    it('is disabled with a hint until at least one image is queued', () => {
        render(<BulkCompressTool />);
        const button = screen.getByRole('button', { name: /^Compress 0 images$/ });
        expect(button).toBeDisabled();
        expect(screen.getByText('Add images to turn this on.')).toBeInTheDocument();
    });

    it('counts the queued images, singular and plural', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);
        expect(screen.getByRole('button', { name: /^Compress 1 image$/ })).toBeEnabled();

        await uploadFiles([imageFile('b.jpg', 'png')]);
        expect(screen.getByRole('button', { name: /^Compress 2 images$/ })).toBeEnabled();
    });

    it('calls run with the target bytes and mode currently on screen', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);
        await user.click(chip('500 KB'));
        await user.click(screen.getByRole('radio', { name: 'Fit under limit' }));

        await user.click(screen.getByRole('button', { name: /^Compress 1 image$/ }));

        expect(harness.run).toHaveBeenCalledTimes(1);
        const [items, options] = harness.run.mock.calls[0];
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ name: 'a.jpg', sourceWidth: 1600, sourceHeight: 1067 });
        expect(options).toEqual({ targetBytes: 500 * 1024, mode: 'fit' });
    });
});

describe('unsupported and oversized intake', () => {
    it('bounces a non-image file into the Results list without blocking the good ones', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('good.jpg'), disguisedFile('notes.txt')]);

        // The button counts what will actually run, not what was dropped —
        // "Selected" in the summary is the one that counts the rejection too.
        expect(screen.getByRole('button', { name: /^Compress 1 image$/ })).toBeInTheDocument();

        const row = screen.getByText('notes.txt').closest('li');
        expect(row).toHaveAttribute('data-status', 'unsupported');
        expect(within(row).getByText(/not a jpeg, png or webp/i)).toBeInTheDocument();
    });

    it('bounces an oversized file as too large for this device', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('huge.jpg', 'jpeg', { size: 21 * 1024 * 1024 })]);

        const row = screen.getByText('huge.jpg').closest('li');
        expect(row).toHaveAttribute('data-status', 'unsafe');
    });

    it('gives every bounced file its own accurate reason — no generic fallback for the second one onward', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([disguisedFile('one.txt'), imageFile('two.jpg', 'jpeg', { size: 21 * 1024 * 1024 })]);

        const first = within(screen.getByText('one.txt').closest('li'));
        const second = within(screen.getByText('two.jpg').closest('li'));

        expect(first.getByText(/pick one of those formats/i)).toBeInTheDocument();
        // The second file's own reason (too large), not the generic wrong-format
        // fallback a shared-first-error scheme would have printed for it.
        expect(second.getByText(/that file is 21 mb/i)).toBeInTheDocument();
        expect(second.queryByText('Not a JPEG, PNG or WebP.')).toBeNull();
    });

    it('gives two files rejected for the SAME reason that same real sentence each, not a shared generic one', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([disguisedFile('one.txt'), disguisedFile('two.pdf')]);

        const first = within(screen.getByText('one.txt').closest('li'));
        const second = within(screen.getByText('two.pdf').closest('li'));

        expect(first.getByText(/pick one of those formats/i)).toBeInTheDocument();
        expect(second.getByText(/pick one of those formats/i)).toBeInTheDocument();
    });

    it('shows a rejected file only as a Results row before any run — no summary yet', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('good.jpg'), disguisedFile('notes.txt')]);

        expect(screen.getByText('notes.txt').closest('li')).toHaveAttribute('data-status', 'unsupported');
        expect(screen.queryByRole('heading', { name: 'Batch summary' })).toBeNull();
    });

    it('folds the rejection into "Selected" once a run has happened', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('good.jpg'), disguisedFile('notes.txt')]);
        await user.click(screen.getByRole('button', { name: /^Compress 1 image$/ }));

        await act(async () => {
            patchState({
                settings: { targetBytes: 200 * 1024, mode: 'preserve' },
                rows: [successRowFor('good.jpg')],
                summary: { ...EMPTY_SUMMARY, selected: 1, successful: 1 },
            });
        });

        const summary = screen.getByRole('heading', { name: 'Batch summary' }).closest('section');
        expect(within(summary).getByText('Selected').nextElementSibling).toHaveTextContent('2');
        expect(within(summary).getByText('Unsupported').nextElementSibling).toHaveTextContent('1');
        expect(within(summary).getByText('Successful').nextElementSibling).toHaveTextContent('1');
    });

    it('points a HEIC file at the converter instead of calling it unsupported and stopping there', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('good.jpg'), disguisedFile('holiday.heic')]);

        const row = document.querySelector('ul[aria-label="Results"] li[data-name="holiday.heic"]');
        expect(row).not.toBeNull();
        expect(row.dataset.status).toBe('unsupported');
        expect(row.textContent).toMatch(/HEIC/);
        expect(row.textContent).toMatch(/\/heic\b/);
    });

    it('never sends a rejected file to run()', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('good.jpg'), disguisedFile('notes.txt')]);

        await user.click(screen.getByRole('button', { name: /^Compress 1 image$/ }));

        const [items] = harness.run.mock.calls[0];
        expect(items.map((item) => item.name)).toEqual(['good.jpg']);
    });
});

describe('while a batch is running', () => {
    it('shows a live progress line naming the current file', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg'), imageFile('b.jpg')]);

        await act(async () => {
            patchState({
                isProcessing: true,
                rows: [waitingRowFor('a.jpg'), processingRowFor('b.jpg')],
                counts: { total: 2, settled: 0, current: 'b.jpg' },
            });
        });

        expect(screen.getByText('0 of 2 done · Compressing b.jpg')).toBeInTheDocument();
    });

    it('shows a Stop button that calls cancel, and hides once processing ends', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);

        await act(async () => {
            patchState({
                isProcessing: true,
                rows: [processingRowFor('a.jpg')],
                counts: { total: 1, settled: 0, current: 'a.jpg' },
            });
        });

        const stop = screen.getByRole('button', { name: 'Stop' });
        await user.click(stop);
        expect(harness.cancel).toHaveBeenCalledTimes(1);

        await act(async () => {
            patchState({
                isProcessing: false,
                rows: [successRowFor('a.jpg')],
                summary: { ...EMPTY_SUMMARY, selected: 1, successful: 1 },
            });
        });

        expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    });

    it('switches the progress line to the completed sentence once the run settles', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg'), imageFile('b.jpg')]);

        await act(async () => {
            patchState({
                isProcessing: false,
                rows: [successRowFor('a.jpg'), unmetRowFor('b.jpg')],
                summary: { ...EMPTY_SUMMARY, selected: 2, successful: 1, unmet: 1 },
            });
        });

        expect(screen.getByText('1 of 2 compressed')).toBeInTheDocument();
    });

    it('moves focus to the Batch summary heading once the run ends', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);

        await act(async () => {
            patchState({
                isProcessing: true,
                rows: [processingRowFor('a.jpg')],
                counts: { total: 1, settled: 0, current: 'a.jpg' },
            });
        });

        await act(async () => {
            patchState({
                settings: { targetBytes: 200 * 1024, mode: 'preserve' },
                isProcessing: false,
                rows: [successRowFor('a.jpg')],
                summary: { ...EMPTY_SUMMARY, selected: 1, successful: 1 },
            });
        });

        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Batch summary' }));
    });

    it('disables the size chips, the custom limit and the mode radios so a change cannot land mid-run', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);

        await act(async () => {
            patchState({
                isProcessing: true,
                rows: [processingRowFor('a.jpg')],
                counts: { total: 1, settled: 0, current: 'a.jpg' },
            });
        });

        expect(chip('200 KB')).toBeDisabled();
        expect(limitInput()).toBeDisabled();
        expect(screen.getByRole('radio', { name: 'Preserve dimensions' })).toBeDisabled();
        expect(screen.getByRole('radio', { name: 'Fit under limit' })).toBeDisabled();

        await act(async () => {
            patchState({
                isProcessing: false,
                rows: [successRowFor('a.jpg')],
                summary: { ...EMPTY_SUMMARY, selected: 1, successful: 1 },
            });
        });

        expect(chip('200 KB')).toBeEnabled();
        expect(limitInput()).toBeEnabled();
    });

    it('keeps both fieldsets shrinkable, so the horizontally-scrolling chip row cannot force the page wider', () => {
        render(<BulkCompressTool />);

        // A <fieldset> defaults to min-width: min-content in every browser,
        // which stops the chip row's overflow-x-auto from ever shrinking and
        // pushes the whole page wider at a phone width — measured at 419px
        // against a 390px viewport. min-w-0 overrides that default; max-w-full
        // on the outer wrapper keeps it from growing past its own container.
        const outerFieldset = limitInput().closest('fieldset');
        expect(outerFieldset).toHaveClass('min-w-0', 'max-w-full');

        const modeFieldset = screen.getByRole('group', { name: 'If the limit cannot be reached at full size' });
        expect(modeFieldset.tagName).toBe('FIELDSET');
        expect(modeFieldset).toHaveClass('min-w-0');
    });
});

describe('the Batch summary and its buttons', () => {
    it('states the saving as an unsigned percentage, never a double negative', () => {
        render(<BulkCompressTool />);
        act(() => {
            patchState({
                settings: { targetBytes: 200 * 1024, mode: 'preserve' },
                rows: [successRowFor('a.jpg')],
                summary: {
                    ...EMPTY_SUMMARY,
                    selected: 1,
                    successful: 1,
                    inputBytes: 1_000_000,
                    outputBytes: 120_000,
                    savedBytes: 880_000,
                    reductionPercent: 88,
                },
            });
        });

        const summary = screen.getByRole('heading', { name: 'Batch summary' }).closest('section');
        expect(summary).toHaveTextContent(/You saved .+ — 88% smaller/);
        expect(summary.textContent).not.toContain('−88%');
        expect(summary.textContent).not.toContain('-88%');
    });

    async function withOneSuccessAndOneUnmet() {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg'), imageFile('b.jpg')]);
        await act(async () => {
            patchState({
                settings: { targetBytes: 200 * 1024, mode: 'preserve' },
                isProcessing: false,
                rows: [successRowFor('a.jpg'), unmetRowFor('b.jpg')],
                summary: {
                    ...EMPTY_SUMMARY,
                    selected: 2,
                    successful: 1,
                    unmet: 1,
                    inputBytes: 500 * 1024,
                    outputBytes: 190 * 1024,
                    savedBytes: 310 * 1024,
                    reductionPercent: 62,
                },
            });
        });
    }

    it('shows every count named in the contract', async () => {
        await withOneSuccessAndOneUnmet();
        const summary = screen.getByRole('heading', { name: 'Batch summary' }).closest('section');

        for (const [dt, value] of [
            ['Selected', '2'],
            ['Successful', '1'],
            ['Could not meet target', '1'],
            ['Unsupported', '0'],
            ['Too large for this device', '0'],
            ['Cancelled', '0'],
        ]) {
            expect(within(summary).getByText(dt).nextElementSibling).toHaveTextContent(value);
        }

        expect(within(summary).getByText('Total before').nextElementSibling).toHaveTextContent('500 KB');
        expect(within(summary).getByText('Total after').nextElementSibling).toHaveTextContent('190 KB');
        expect(within(summary).getByText('Saved').nextElementSibling).toHaveTextContent('310 KB');
        expect(within(summary).getByText('Reduction').nextElementSibling).toHaveTextContent('62%');
    });

    it('shows Download all as ZIP only once something succeeded, and wires it to downloadZip', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);

        expect(screen.queryByRole('button', { name: /download all as zip/i })).toBeNull();

        await act(async () => {
            patchState({
                settings: { targetBytes: 200 * 1024, mode: 'preserve' },
                rows: [successRowFor('a.jpg')],
                summary: { ...EMPTY_SUMMARY, selected: 1, successful: 1 },
            });
        });

        const zip = screen.getByRole('button', { name: 'Download all as ZIP (1)' });
        await user.click(zip);
        expect(harness.downloadZip).toHaveBeenCalledTimes(1);
    });

    it('shows Retry failed only once something is retryable, and reruns the ORIGINAL items with the CURRENT settings', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);

        expect(screen.queryByRole('button', { name: /retry failed/i })).toBeNull();

        await user.click(screen.getByRole('button', { name: /^Compress 1 image$/ }));
        const [items] = harness.run.mock.calls[0];

        await act(async () => {
            patchState({
                settings: { targetBytes: 200 * 1024, mode: 'preserve' },
                rows: [unmetRowFor('a.jpg')],
                summary: { ...EMPTY_SUMMARY, selected: 1, unmet: 1 },
            });
        });

        const retry = screen.getByRole('button', { name: 'Retry failed (1)' });
        await user.click(retry);

        expect(harness.retry).toHaveBeenCalledTimes(1);
        expect(harness.retry.mock.calls[0][0]).toEqual(items);
        expect(harness.retry.mock.calls[0][1]).toEqual({ targetBytes: 200 * 1024, mode: 'preserve' });
    });

    it('shows the ZIP failure as an alert', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);

        await act(async () => {
            patchState({
                settings: { targetBytes: 200 * 1024, mode: 'preserve' },
                rows: [successRowFor('a.jpg')],
                summary: { ...EMPTY_SUMMARY, selected: 1, successful: 1 },
                zipError: ZIP_FAILED_MESSAGE,
            });
        });

        expect(screen.getByRole('alert')).toHaveTextContent(ZIP_FAILED_MESSAGE);
    });

    it('Start over clears the hook, the upload queue and any rejected rows', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('good.jpg'), disguisedFile('notes.txt')]);

        await user.click(screen.getByRole('button', { name: 'Start over' }));

        expect(harness.reset).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('notes.txt')).toBeNull();
        expect(screen.getByRole('button', { name: /^Compress 0 images$/ })).toBeInTheDocument();
    });
});

describe('the "You saved" headline', () => {
    it('states the reduction as a plain percent, never a double negative with "smaller"', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);

        await act(async () => {
            patchState({
                settings: { targetBytes: 200 * 1024, mode: 'preserve' },
                rows: [successRowFor('a.jpg')],
                summary: {
                    ...EMPTY_SUMMARY,
                    selected: 1,
                    successful: 1,
                    inputBytes: 1024000,
                    outputBytes: 122880,
                    savedBytes: 901120,
                    reductionPercent: 88,
                },
            });
        });

        const headline = screen.getByText(/You saved/);
        expect(headline).toHaveTextContent('You saved 880 KB — 88% smaller');
        // The per-row Reduction cell is allowed the real minus sign; the
        // headline sentence already says "smaller" and must not double up.
        expect(headline).not.toHaveTextContent('−88%');
        expect(headline).not.toHaveTextContent('-88%');
    });

    it('renders no headline at all when nothing succeeded', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);

        await act(async () => {
            patchState({
                settings: { targetBytes: 200 * 1024, mode: 'preserve' },
                rows: [unmetRowFor('a.jpg')],
                summary: { ...EMPTY_SUMMARY, selected: 1, unmet: 1, reductionPercent: null },
            });
        });

        expect(screen.queryByText(/You saved/)).toBeNull();
    });

    it('renders no headline when every file was kept as-is (reductionPercent 0, savedBytes 0)', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);

        await act(async () => {
            patchState({
                settings: { targetBytes: 200 * 1024, mode: 'preserve' },
                rows: [successRowFor('a.jpg', { kept: true, resized: false, note: 'Already under 200 KB — kept at its size, metadata removed.' })],
                summary: {
                    ...EMPTY_SUMMARY,
                    selected: 1,
                    successful: 1,
                    inputBytes: 500 * 1024,
                    outputBytes: 500 * 1024,
                    savedBytes: 0,
                    reductionPercent: 0,
                },
            });
        });

        // A batch where nothing was re-encoded genuinely saved nothing — the
        // row itself already says why (kept, not compressed), so a "You saved
        // 0 Bytes — 0% smaller" headline above it would be a second, emptier
        // way of saying the same thing.
        expect(screen.queryByText(/You saved/)).toBeNull();
    });
});

describe('focus management when something leaves the screen', () => {
    it('moves focus to the browse button after removing a selected file', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);

        await user.click(screen.getByRole('button', { name: 'Remove: a.jpg' }));

        expect(document.activeElement).toBe(document.getElementById('bulk-compress-file-browse'));
    });

    it('moves focus to the browse button after Start over', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('good.jpg'), disguisedFile('notes.txt')]);

        await user.click(screen.getByRole('button', { name: 'Start over' }));

        expect(document.activeElement).toBe(document.getElementById('bulk-compress-file-browse'));
    });

    // The summary-heading case is covered in "while a batch is running" above
    // and must keep passing unchanged.
});

describe('the live regions announce reliably, once, and only when there is news', () => {
    it('mounts the status line from the very first render, empty until a run starts', () => {
        render(<BulkCompressTool />);

        const status = document.querySelector('p[role="status"][aria-live="polite"][aria-atomic="true"]');
        expect(status).toBeInTheDocument();
        expect(status).toHaveTextContent('');
    });

    it('gives the Batch summary section no aria-live of its own — one announcement, not two competing ones', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);

        await act(async () => {
            patchState({
                settings: { targetBytes: 200 * 1024, mode: 'preserve' },
                rows: [successRowFor('a.jpg')],
                summary: { ...EMPTY_SUMMARY, selected: 1, successful: 1 },
            });
        });

        const section = screen.getByRole('heading', { name: 'Batch summary' }).closest('section');
        expect(section).not.toHaveAttribute('aria-live');
    });
});

describe('stale results', () => {
    it('flags results made with different settings and switches the action to "Compress again"', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);
        await user.click(screen.getByRole('button', { name: /^Compress 1 image$/ }));

        await act(async () => {
            patchState({
                settings: { targetBytes: 200 * 1024, mode: 'preserve' },
                rows: [successRowFor('a.jpg')],
                summary: { ...EMPTY_SUMMARY, selected: 1, successful: 1 },
            });
        });

        expect(screen.queryByText(/press compress again to apply your new settings/i)).toBeNull();
        expect(screen.queryByRole('button', { name: /^Compress again$/ })).toBeNull();

        await user.click(chip('500 KB'));

        const stale = screen.getByText(/press compress again to apply your new settings/i);
        expect(stale).toHaveTextContent(
            'These results were made with 200 KB · Preserve dimensions. Press Compress again to apply your new settings.',
        );
        expect(screen.getByRole('button', { name: /^Compress again$/ })).toBeInTheDocument();
    });
});

describe('changing the selection after a run', () => {
    async function runOnce() {
        const user = userEvent.setup();
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);
        await user.click(screen.getByRole('button', { name: /^Compress 1 image$/ }));

        // The row's id has to be the REAL id useImageUpload generated for
        // a.jpg (captured off the actual run() call), not the human-readable
        // 'a.jpg' successRowFor defaults to — otherwise a.jpg's own upload
        // entry never matches its own hook row, and it would incorrectly get
        // treated as a newly-added file with no row of its own.
        const [items] = harness.run.mock.calls.at(-1);

        await act(async () => {
            patchState({
                settings: { targetBytes: 200 * 1024, mode: 'preserve' },
                rows: [successRowFor('a.jpg', { id: items[0].id })],
                summary: { ...EMPTY_SUMMARY, selected: 1, successful: 1 },
            });
        });
    }

    it('flags a different file set as stale, with its own message, once a file is added', async () => {
        await runOnce();

        await uploadFiles([imageFile('b.jpg', 'png')]);

        const stale = screen.getByText(/you changed the selection since the last run/i);
        expect(stale).toHaveTextContent(
            'You changed the selection since the last run. Press Compress again to apply it.',
        );
        expect(screen.getByRole('button', { name: /^Compress again$/ })).toBeInTheDocument();
    });

    it('no longer offers to remove a card once a run has happened — Start over is the only way', async () => {
        await runOnce();

        expect(screen.queryByRole('button', { name: /^Remove:/ })).toBeNull();
        expect(screen.getByText('To take a file out after a run, press Start over.')).toBeInTheDocument();
    });

    it('does not show the "take a file out" sentence, or hide the remove button, before any run', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);

        expect(screen.queryByText(/to take a file out after a run/i)).toBeNull();
        expect(screen.getByRole('button', { name: 'Remove: a.jpg' })).toBeInTheDocument();
    });

    it('gives a file added after a run its own waiting row, placed after the hook rows and before any rejections', async () => {
        await runOnce();
        await uploadFiles([imageFile('b.jpg', 'png'), disguisedFile('notes.txt')]);

        const rows = within(screen.getByRole('list', { name: 'Results' })).getAllByRole('listitem');
        expect(rows.map((row) => row.dataset.name)).toEqual(['a.jpg', 'b.jpg', 'notes.txt']);
        expect(rows[1]).toHaveAttribute('data-status', 'waiting');
        expect(within(rows[1]).getByText('Waiting')).toBeInTheDocument();
        // Not run yet, so nothing to download and no target verdict.
        expect(within(rows[1]).queryByRole('button', { name: /download/i })).toBeNull();
    });

    it('gives a second file with the SAME NAME as an already-finished one its own waiting row too', async () => {
        // Two different files can share a name — the same photo re-added, or
        // two IMG_0001.jpg from different folders. Matching by name as well as
        // id would make the second one invisible: exactly the bug this row
        // exists to fix, just triggered a different way.
        await runOnce();
        await uploadFiles([imageFile('a.jpg')]);

        const rows = within(screen.getByRole('list', { name: 'Results' })).getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveAttribute('data-status', 'success');
        expect(rows[1]).toHaveAttribute('data-status', 'waiting');
        expect(rows[1]).toHaveAttribute('data-name', 'a.jpg');
    });

    it('keeps "Selected" equal to the number of rows actually shown, even after adding a file', async () => {
        await runOnce();
        await uploadFiles([imageFile('b.jpg', 'png')]);

        const summary = screen.getByRole('heading', { name: 'Batch summary' }).closest('section');
        expect(within(summary).getByText('Selected').nextElementSibling).toHaveTextContent('2');
    });

    it('keeps the settled progress line to the files the hook itself actually ran, unaffected by a later addition', async () => {
        await runOnce();
        expect(screen.getByText('1 of 1 compressed')).toBeInTheDocument();

        await uploadFiles([imageFile('b.jpg', 'png')]);

        // Still 1 of 1: the engine has not touched b.jpg yet, so it must not be
        // folded into either side of this sentence.
        expect(screen.getByText('1 of 1 compressed')).toBeInTheDocument();
    });
});

describe('a retry that leaves the rows at more than one setting', () => {
    it('names the mix instead of claiming one setting for every row', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg'), imageFile('b.jpg')]);
        await user.click(screen.getByRole('button', { name: /^Compress 2 images$/ }));

        await act(async () => {
            patchState({
                settings: { targetBytes: 200 * 1024, mode: 'preserve' },
                rows: [
                    successRowFor('a.jpg', { targetBytes: 200 * 1024 }),
                    unmetRowFor('b.jpg', { targetBytes: 200 * 1024 }),
                ],
                summary: { ...EMPTY_SUMMARY, selected: 2, successful: 1, unmet: 1 },
            });
        });

        // Retry at a new limit — only b.jpg (the retryable row) is redone;
        // a.jpg's row still carries the FIRST run's target.
        await user.click(chip('500 KB'));
        await user.click(screen.getByRole('button', { name: /^Retry failed/i }));

        await act(async () => {
            patchState({
                settings: { targetBytes: 500 * 1024, mode: 'preserve' },
                rows: [
                    successRowFor('a.jpg', { targetBytes: 200 * 1024 }),
                    successRowFor('b.jpg', { targetBytes: 500 * 1024 }),
                ],
                summary: { ...EMPTY_SUMMARY, selected: 2, successful: 2 },
            });
        });

        const stale = screen.getByText(/more than one setting/i);
        expect(stale).toHaveTextContent(
            'These results were made with more than one setting — each row states its own limit. '
            + 'Press Compress again to redo them all with the current settings.',
        );
        expect(screen.getByRole('button', { name: /^Compress again$/ })).toBeInTheDocument();
    });

    it('says nothing of the kind when every row still agrees', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg'), imageFile('b.jpg')]);
        await user.click(screen.getByRole('button', { name: /^Compress 2 images$/ }));
        await act(async () => {
            patchState({
                settings: { targetBytes: 200 * 1024, mode: 'preserve' },
                rows: [
                    successRowFor('a.jpg', { targetBytes: 200 * 1024 }),
                    successRowFor('b.jpg', { targetBytes: 200 * 1024 }),
                ],
                summary: { ...EMPTY_SUMMARY, selected: 2, successful: 2 },
            });
        });

        expect(screen.queryByText(/more than one setting/i)).toBeNull();
        expect(screen.queryByRole('button', { name: /^Compress again$/ })).toBeNull();
    });
});

describe('focus while a run is in progress', () => {
    it('lands on Stop the moment a run starts, because the disabled action would drop it to the body', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);
        act(() => {
            patchState({ isProcessing: true, rows: [processingRowFor('a.jpg')] });
        });

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stop' }));
    });
});

