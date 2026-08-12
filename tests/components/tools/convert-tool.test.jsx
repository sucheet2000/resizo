/**
 * ConvertTool on the local-first seam.
 *
 * The engine itself is proved in tests/lib/image-client/convert.test.js against
 * real pixels. What is left to prove is the wiring, which is where an adoption
 * of this seam actually goes wrong:
 *
 *  - the op reaches the hook as 'convert', not as an endpoint that quietly keeps
 *    uploading
 *  - the MEASURED dimensions are handed over. useImageUpload already read them
 *    at intake; if the page forgets to pass them on, the memory gate cannot cost
 *    the job until a decode has already allocated, which on iOS is a tab the
 *    browser kills with nothing to catch
 *  - a local failure ends with the visitor's file converted anyway, on the
 *    server, with no error shown in between
 *  - the codec heaps are let go of when the page unmounts
 *
 * The two selects are checked against lib/constants.js in the same file, because
 * a menu is a format list too — the one place the page could still offer a
 * conversion the tool has stopped supporting.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

vi.mock('@vercel/blob/client', () => ({ upload: vi.fn() }));

import ConvertTool from '@/app/(tools)/convert/ConvertTool';
import { CONVERT_INPUT_FORMATS, CONVERT_OUTPUT_FORMATS } from '@/lib/constants';
import { formatLabel } from '@/lib/hooks/upload-helpers';
import { blobOfSize, imageFile, installFakeXhr, setInputFiles, stubImageProbe } from '../helpers.jsx';

const SOURCE_WIDTH = 1200;
const SOURCE_HEIGHT = 800;

let xhr;
let probe;

beforeEach(() => {
    xhr = installFakeXhr();
    probe = stubImageProbe({ width: SOURCE_WIDTH, height: SOURCE_HEIGHT });
    processImageMock.mockReset();
    terminateWorkerMock.mockReset();
    vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
    xhr.restore();
    probe.restore();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function localOutcome({ format = 'webp', bytes = 41_000 } = {}) {
    return {
        blob: blobOfSize(bytes, `image/${format}`),
        filename: `resizo-converted-photo.${format}`,
        format,
        width: SOURCE_WIDTH,
        height: SOURCE_HEIGHT,
        originalBytes: 120_000,
        resultBytes: bytes,
        savedPercent: 66,
    };
}

/** Renders the tool and drops one file on it, exactly as the picker would. */
async function dropFile(utils, file = imageFile('photo.png', 'png', { size: 120_000 })) {
    const input = utils.container.querySelector('input[type="file"]');
    setInputFiles(input, [file]);
    fireEvent.change(input);
    await screen.findByText(file.name);
}

async function convert() {
    await userEvent.click(screen.getByRole('button', { name: /^Convert to/ }));
}

describe('ConvertTool — the menus come from the registry', () => {
    it('offers every input format and nothing else', () => {
        render(<ConvertTool />);
        const options = Array.from(screen.getByLabelText('From').options).map((option) => option.value);

        expect(options).toEqual(['', ...CONVERT_INPUT_FORMATS]);
    });

    it('offers every output format and nothing else', () => {
        render(<ConvertTool />);
        const options = Array.from(screen.getByLabelText('To').options).map((option) => option.value);

        expect(options).toEqual(CONVERT_OUTPUT_FORMATS);
    });

    it('says which formats it takes without naming them by hand', () => {
        render(<ConvertTool />);
        const hint = screen.getByText(/Leave on Detect to accept/);

        for (const format of CONVERT_INPUT_FORMATS) {
            expect(hint).toHaveTextContent(formatLabel(format));
        }
    });
});

describe('ConvertTool — converting on the device', () => {
    it('runs the conversion locally and uploads nothing', async () => {
        processImageMock.mockResolvedValue(localOutcome());
        const utils = render(<ConvertTool />);

        await dropFile(utils);
        await convert();

        await waitFor(() => expect(processImageMock).toHaveBeenCalledTimes(1));
        expect(processImageMock.mock.calls[0][0]).toBe('convert');
        expect(xhr.requests).toHaveLength(0);

        await screen.findByRole('button', { name: /Download WebP/ });
    });

    it('passes the dimensions it already measured into the gate', async () => {
        processImageMock.mockResolvedValue(localOutcome());
        const utils = render(<ConvertTool />);

        await dropFile(utils);
        await convert();

        await waitFor(() => expect(processImageMock).toHaveBeenCalledTimes(1));
        const [, , options] = processImageMock.mock.calls[0];

        expect(options.sourceWidth).toBe(SOURCE_WIDTH);
        expect(options.sourceHeight).toBe(SOURCE_HEIGHT);
        // The target format still travels under the field name the route reads,
        // so the same FormData works in whichever lane wins.
        expect(options.format).toBe('webp');
    });

    it('sends the format the To menu is showing, not the default', async () => {
        processImageMock.mockResolvedValue(localOutcome({ format: 'jpeg' }));
        const utils = render(<ConvertTool />);

        await dropFile(utils);
        await userEvent.selectOptions(screen.getByLabelText('To'), 'jpeg');
        await convert();

        await waitFor(() => expect(processImageMock).toHaveBeenCalledTimes(1));
        expect(processImageMock.mock.calls[0][2].format).toBe('jpeg');
    });
});

describe('ConvertTool — the server fallback', () => {
    it('uploads when WebAssembly is unavailable', async () => {
        vi.stubGlobal('WebAssembly', undefined);
        const utils = render(<ConvertTool />);

        await dropFile(utils);
        await convert();

        await waitFor(() => expect(xhr.requests).toHaveLength(1));
        expect(processImageMock).not.toHaveBeenCalled();
        expect(xhr.last().url).toBe('/api/convert');
        expect(xhr.last().sentBody.get('target_format')).toBe('webp');
    });

    it('finishes on the server when the local run fails, showing nothing in between', async () => {
        processImageMock.mockRejectedValue(Object.assign(new Error('codec would not load'), { code: 'failed' }));
        const utils = render(<ConvertTool />);

        await dropFile(utils);
        await convert();

        await waitFor(() => expect(xhr.requests).toHaveLength(1));
        expect(processImageMock).toHaveBeenCalledTimes(1);
        // The abandoned attempt is not an event the visitor is told about.
        expect(screen.queryByText('codec would not load')).toBeNull();

        await xhr.last().respond({
            status: 200,
            headers: {
                'Content-Type': 'image/webp',
                'Content-Disposition': 'attachment; filename="resizo-converted-photo.webp"',
                'X-Original-Size': '120000',
                'X-Output-Size': '41000',
            },
            body: blobOfSize(41_000, 'image/webp'),
        });

        await screen.findByRole('button', { name: /Download WebP/ });
    });

    it('lets go of the codec heaps when the page unmounts', async () => {
        processImageMock.mockResolvedValue(localOutcome());
        const utils = render(<ConvertTool />);

        await dropFile(utils);
        utils.unmount();

        expect(terminateWorkerMock).toHaveBeenCalledTimes(1);
    });
});
