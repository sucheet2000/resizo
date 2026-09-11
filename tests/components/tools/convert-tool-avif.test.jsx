/**
 * ConvertTool + ./formats — once AVIF is in the registry.
 *
 * Mocked rather than trusted to the real lib/limits.js, which is a second
 * agent's file landing concurrently on this same branch: mocking makes this
 * suite pass whether that change has arrived yet or not. The override is
 * additive-if-absent, so it stays a no-op once the real registry catches up
 * rather than producing a duplicate 'avif' entry.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { processImageMock, terminateWorkerMock } = vi.hoisted(() => ({
    processImageMock: vi.fn(),
    terminateWorkerMock: vi.fn(),
}));

vi.mock('@/lib/image-client/client', () => ({
    processImage: processImageMock,
    terminateWorker: terminateWorkerMock,
}));

vi.mock('@/lib/limits', async (importOriginal) => {
    const actual = await importOriginal();
    const withAvif = (list) => (list.includes('avif') ? list : [...list, 'avif']);
    return {
        ...actual,
        CONVERT_INPUT_FORMATS: withAvif(actual.CONVERT_INPUT_FORMATS),
        CONVERT_OUTPUT_FORMATS: withAvif(actual.CONVERT_OUTPUT_FORMATS),
    };
});

import ConvertTool from '@/app/(tools)/convert/ConvertTool';
import { FORMAT_FACTS, formatComparison } from '@/app/(tools)/convert/formats';
import { CONVERT_OUTPUT_FORMATS } from '@/lib/limits';
import { blobOfSize, imageFile, installNetworkSentinel, setInputFiles, stubImageProbe } from '../helpers.jsx';

const SOURCE_WIDTH = 1200;
const SOURCE_HEIGHT = 800;

let network;
let probe;

beforeEach(() => {
    network = installNetworkSentinel();
    probe = stubImageProbe({ width: SOURCE_WIDTH, height: SOURCE_HEIGHT });
    processImageMock.mockReset();
    terminateWorkerMock.mockReset();
    vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
    network.restore();
    probe.restore();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function localOutcome({ format = 'avif', bytes = 41_000, sourceBitDepth = null } = {}) {
    return {
        blob: blobOfSize(bytes, `image/${format}`),
        filename: `resizo-converted-photo.${format}`,
        format,
        width: SOURCE_WIDTH,
        height: SOURCE_HEIGHT,
        originalBytes: 120_000,
        resultBytes: bytes,
        savedPercent: 66,
        sourceBitDepth,
    };
}

async function dropFile(utils, file = imageFile('photo.png', 'png', { size: 120_000 })) {
    const input = utils.container.querySelector('input[type="file"]');
    setInputFiles(input, [file]);
    fireEventChange(input);
    await screen.findByText(file.name);
}

function fireEventChange(input) {
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('./formats — FORMAT_FACTS has an AVIF entry', () => {
    it('does not throw building the comparison table now that AVIF is an output', () => {
        expect(() => formatComparison()).not.toThrow();
    });

    it('states AVIF facts truthfully: keeps transparency, is lossy, not always the smallest', () => {
        const avif = FORMAT_FACTS.avif;

        expect(avif.alpha).toBe(true);
        expect(avif.lossless).toBe(false);
        expect(avif.best).not.toMatch(/always smallest|smallest of (the|all)/i);
    });

    it('includes an AVIF row in the comparison table once it is a registry output', () => {
        const row = formatComparison().find((entry) => entry.format === 'avif');

        expect(row).toBeDefined();
        expect(row.transparency).toBe('Yes');
        expect(row.compression).toBe('Lossy');
    });
});

describe('ConvertTool — the menus pick up AVIF from the registry', () => {
    it('offers AVIF in both selects, derived, never hand-typed', () => {
        render(<ConvertTool />);

        expect(Array.from(screen.getByLabelText('From').options).map((o) => o.value)).toContain('avif');
        expect(Array.from(screen.getByLabelText('To').options).map((o) => o.value)).toContain('avif');
    });

    it('names both WebP and AVIF in the To hint, and says AVIF is slower and not universally supported', () => {
        render(<ConvertTool />);
        const hint = screen.getByText(/WebP is usually the smallest/);

        expect(hint).toHaveTextContent(/AVIF is often smaller still but slower to write/i);
        expect(hint).toHaveTextContent(/not every app opens it/i);
    });

    it('moves To off of AVIF when From is changed to AVIF too, same as any other pair', async () => {
        render(<ConvertTool />);
        await userEvent.selectOptions(screen.getByLabelText('To'), 'avif');
        await userEvent.selectOptions(screen.getByLabelText('From'), 'avif');

        expect(screen.getByLabelText('To')).not.toHaveValue('avif');
    });
});

describe('ConvertTool — writing AVIF', () => {
    it('reads "Encoding AVIF…" with no percentage and no progressbar while it runs', async () => {
        let resolveJob;
        processImageMock.mockImplementation((op, file, options, { onProgress }) => {
            onProgress?.(65, 'encoding');
            return new Promise((resolve) => { resolveJob = resolve; });
        });

        const utils = render(<ConvertTool />);
        await dropFile(utils);
        await userEvent.selectOptions(screen.getByLabelText('To'), 'avif');
        await userEvent.click(screen.getByRole('button', { name: /^Convert to AVIF$/ }));

        const button = await screen.findByRole('button', { name: /Encoding AVIF…/ });
        expect(button).toBeDisabled();
        expect(button).not.toHaveTextContent('65%');
        expect(screen.queryByRole('progressbar')).toBeNull();

        resolveJob(localOutcome());
        await waitFor(() => expect(processImageMock).toHaveBeenCalledTimes(1));
    });

    it('sends format "avif" to the engine when To is set to AVIF', async () => {
        processImageMock.mockResolvedValue(localOutcome());
        const utils = render(<ConvertTool />);

        await dropFile(utils);
        await userEvent.selectOptions(screen.getByLabelText('To'), 'avif');
        await userEvent.click(screen.getByRole('button', { name: /^Convert to AVIF$/ }));

        await waitFor(() => expect(processImageMock).toHaveBeenCalledTimes(1));
        expect(processImageMock.mock.calls[0][2].format).toBe('avif');
        expect(network.calls).toHaveLength(0);
    });

    it('adds the bit-depth footnote for a 10-bit source, and leaves it out for an 8-bit one', async () => {
        processImageMock.mockResolvedValue(localOutcome({ sourceBitDepth: 10 }));
        const utils = render(<ConvertTool />);

        await dropFile(utils);
        await userEvent.selectOptions(screen.getByLabelText('To'), 'avif');
        await userEvent.click(screen.getByRole('button', { name: /^Convert to AVIF$/ }));

        await screen.findByText(/10-bit source decoded to 8-bit/);
    });

    it('states no bit-depth note for an ordinary 8-bit source', async () => {
        processImageMock.mockResolvedValue(localOutcome({ sourceBitDepth: null }));
        const utils = render(<ConvertTool />);

        await dropFile(utils);
        await userEvent.selectOptions(screen.getByLabelText('To'), 'avif');
        await userEvent.click(screen.getByRole('button', { name: /^Convert to AVIF$/ }));

        await screen.findByRole('button', { name: /Download AVIF/ });
        expect(screen.queryByText(/decoded to 8-bit/)).toBeNull();
    });
});
