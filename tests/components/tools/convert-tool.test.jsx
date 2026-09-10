/**
 * ConvertTool, wired to the engine in the tab.
 *
 * The engine itself is proved in tests/lib/image-client/convert.test.js against
 * real pixels. What is left to prove is the wiring, which is where this goes
 * wrong in practice:
 *
 *  - the op reaches the hook as 'convert', and NOTHING touches the network — a
 *    sentinel throws on any XHR, fetch or sendBeacon, so this is checked from
 *    the network side rather than by trusting the engine mock's call count
 *  - the MEASURED dimensions are handed over. useImageUpload already read them
 *    at intake; if the page forgets to pass them on, the memory gate cannot cost
 *    the job until a decode has already allocated, which on iOS is a tab the
 *    browser kills with nothing to catch
 *  - a failure is SHOWN. It used to be swallowed while the file went to the
 *    server instead; there is no server, so a silent failure would now be a
 *    visitor staring at a button that did nothing
 *  - the codec heaps are let go of when the page unmounts
 *
 * The two selects are checked against lib/limits.js in the same file, because
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

import ConvertTool from '@/app/(tools)/convert/ConvertTool';
import { CONVERT_INPUT_FORMATS, CONVERT_OUTPUT_FORMATS } from '@/lib/limits';
import { formatLabel } from '@/lib/format/upload-helpers';
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
        expect(network.calls).toHaveLength(0);

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

describe('ConvertTool — what happens when it cannot be done here', () => {
    it('tells the visitor when WebAssembly is unavailable, and uploads nothing', async () => {
        // This used to upload to /api/convert. The whole point of the change is
        // that it no longer can, so the visitor is told instead of being served
        // quietly from somewhere else.
        vi.stubGlobal('WebAssembly', undefined);
        const utils = render(<ConvertTool />);

        await dropFile(utils);
        await convert();

        await screen.findByText(/WebAssembly/);
        expect(processImageMock).not.toHaveBeenCalled();
        expect(network.calls).toHaveLength(0);

        vi.unstubAllGlobals();
    });

    it('shows the failure when the run fails, rather than swallowing it', async () => {
        processImageMock.mockRejectedValue(Object.assign(new Error('The image codec would not load.'), { code: 'failed' }));
        const utils = render(<ConvertTool />);

        await dropFile(utils);
        await convert();

        await screen.findByText('The image codec would not load.');
        expect(processImageMock).toHaveBeenCalledTimes(1);
        expect(network.calls).toHaveLength(0);
        // No half-finished result panel behind the message.
        expect(screen.queryByRole('button', { name: /Download WebP/ })).toBeNull();
    });

    it('lets go of the codec heaps when the page unmounts', async () => {
        processImageMock.mockResolvedValue(localOutcome());
        const utils = render(<ConvertTool />);

        await dropFile(utils);
        utils.unmount();

        expect(terminateWorkerMock).toHaveBeenCalledTimes(1);
    });
});

/**
 * The transparency background, wired end to end.
 *
 * flatten.test.js proves the parsing, alpha-consistency.test.js proves the
 * option reaches the pixels. What is left, and what these cover, is the rule
 * about WHEN the control is shown and whether the page actually sends it.
 *
 * A control that renders for a JPEG source, or for a PNG output, is a control
 * people learn to ignore — and one that renders correctly but never reaches the
 * form looks identical to a working feature until you check the bytes.
 */
describe('ConvertTool — the transparency background', () => {
    const group = () => screen.queryByRole('group', { name: /transparent areas become/i });

    it('appears when a transparent format is being flattened to JPEG', async () => {
        const utils = render(<ConvertTool preset={{ from: 'png', to: 'jpeg' }} />);
        await dropFile(utils);

        expect(group()).toBeInTheDocument();
    });

    it('stays away when the output keeps its alpha', async () => {
        const utils = render(<ConvertTool preset={{ from: 'png', to: 'webp' }} />);
        await dropFile(utils);

        expect(group(), 'WebP carries alpha — there is nothing to fill').toBeNull();
    });

    it('stays away when the source cannot carry alpha', async () => {
        const utils = render(<ConvertTool preset={{ from: 'jpeg', to: 'jpeg' }} />);
        await dropFile(utils, imageFile('photo.jpg', 'jpeg', { size: 120_000 }));

        expect(group(), 'a JPEG source has no transparency to place').toBeNull();
    });

    it('opens on white, the colour the page copy promises', async () => {
        const utils = render(<ConvertTool preset={{ from: 'png', to: 'jpeg' }} />);
        await dropFile(utils);

        expect(screen.getByRole('radio', { name: /white/i })).toBeChecked();
        expect(screen.getByRole('radio', { name: /black/i })).not.toBeChecked();
    });

    it('reaches the engine as white by default, matching the page copy', async () => {
        processImageMock.mockResolvedValue(localOutcome({ format: 'jpeg' }));
        const utils = render(<ConvertTool preset={{ from: 'png', to: 'jpeg' }} />);

        await dropFile(utils);
        await convert();

        await waitFor(() => expect(processImageMock).toHaveBeenCalledTimes(1));
        expect(processImageMock.mock.calls[0][2].background).toBe('white');
    });

    it('reaches the engine as black when the visitor picks black', async () => {
        processImageMock.mockResolvedValue(localOutcome({ format: 'jpeg' }));
        const utils = render(<ConvertTool preset={{ from: 'png', to: 'jpeg' }} />);

        await dropFile(utils);
        await userEvent.click(screen.getByRole('radio', { name: /black/i }));
        await convert();

        await waitFor(() => expect(processImageMock).toHaveBeenCalledTimes(1));
        expect(processImageMock.mock.calls[0][2].background).toBe('black');
    });

    /**
     * The custom picker is the half that a default change can quietly break: it
     * seeds itself from the preset list, so a reordered list that left the seed
     * behind would post a colour nobody chose.
     */
    it('reaches the engine as the exact hex the visitor picked', async () => {
        processImageMock.mockResolvedValue(localOutcome({ format: 'jpeg' }));
        const utils = render(<ConvertTool preset={{ from: 'png', to: 'jpeg' }} />);

        await dropFile(utils);
        await userEvent.click(screen.getByRole('radio', { name: /custom/i }));
        fireEvent.input(screen.getByLabelText(/custom colour/i), { target: { value: '#2f6fed' } });
        await convert();

        await waitFor(() => expect(processImageMock).toHaveBeenCalledTimes(1));
        expect(processImageMock.mock.calls[0][2].background).toBe('#2f6fed');
    });

    it('sends nothing at all when the control is not shown', async () => {
        processImageMock.mockResolvedValue(localOutcome({ format: 'webp' }));
        const utils = render(<ConvertTool preset={{ from: 'png', to: 'webp' }} />);

        await dropFile(utils);
        await convert();

        await waitFor(() => expect(processImageMock).toHaveBeenCalledTimes(1));
        expect(processImageMock.mock.calls[0][2].background).toBeUndefined();
    });
});
