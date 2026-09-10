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

        // The button counts what was dropped, not just what will run — the
        // same "Selected" count the summary uses once it appears.
        expect(screen.getByRole('button', { name: /^Compress 2 images$/ })).toBeInTheDocument();

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

    it('gives the FIRST rejection the real reason and every later one in the same drop the generic sentence', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([disguisedFile('one.txt'), disguisedFile('two.pdf')]);

        const first = within(screen.getByText('one.txt').closest('li'));
        const second = within(screen.getByText('two.pdf').closest('li'));

        expect(first.getByText(/pick one of those formats/i)).toBeInTheDocument();
        expect(second.getByText('Not a JPEG, PNG or WebP.')).toBeInTheDocument();
    });

    it('counts rejected files into the Batch summary immediately, before any run', async () => {
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('good.jpg'), disguisedFile('notes.txt')]);

        const summary = screen.getByRole('heading', { name: 'Batch summary' }).closest('section');
        expect(within(summary).getByText('Selected').nextElementSibling).toHaveTextContent('2');
        expect(within(summary).getByText('Unsupported').nextElementSibling).toHaveTextContent('1');
        expect(within(summary).getByText('Successful').nextElementSibling).toHaveTextContent('0');
    });

    it('never sends a rejected file to run()', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('good.jpg'), disguisedFile('notes.txt')]);

        await user.click(screen.getByRole('button', { name: /^Compress 2 images$/ }));

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
                isProcessing: false,
                rows: [successRowFor('a.jpg')],
                summary: { ...EMPTY_SUMMARY, selected: 1, successful: 1 },
            });
        });

        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Batch summary' }));
    });
});

describe('the Batch summary and its buttons', () => {
    it('states the saving as an unsigned percentage, never a double negative', () => {
        render(<BulkCompressTool />);
        act(() => {
            patchState({
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
                rows: [unmetRowFor('a.jpg')],
                summary: { ...EMPTY_SUMMARY, selected: 1, unmet: 1, reductionPercent: null },
            });
        });

        expect(screen.queryByText(/You saved/)).toBeNull();
    });
});

describe('stale results', () => {
    it('flags results made with different settings and switches the action to "Compress again"', async () => {
        const user = userEvent.setup();
        render(<BulkCompressTool />);
        await uploadFiles([imageFile('a.jpg')]);

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
