/**
 * HeicTool — the choice of what comes out
 *
 * The converter used to have no settings at all: a HEIC went in and a JPG came
 * back, because that is what "make this openable" means. /heic-to-png exists
 * because a second, narrower audience — editors and forms that name PNG and
 * take nothing else — needs the decoded pixels stored exactly instead, and the
 * honest cost of that is weight rather than quality.
 *
 * The engine is mocked at its module boundary, exactly as every other tool
 * suite mocks it, and no real HEIC pixel appears here: sharp cannot encode
 * HEVC, so a decodable HEIC cannot be committed to this repo. What these
 * assert is therefore the WIRING, which is where the feature can be wrong
 * while looking finished:
 *
 *  - the radio the visitor sees is the format the engine is asked for. A
 *    control that renders correctly and never reaches the form is invisible
 *    until you check the bytes.
 *  - the LABELS follow the choice. The intent copy on /heic-to-jpg and
 *    /heic-to-png tells the visitor, in as many words, to "press Convert to
 *    JPG" / "press Convert to PNG"; a button that disagrees with the sentence
 *    above it is the same defect as a wrong format list.
 *  - a result already on screen does not survive a change of format. The
 *    panel prints the byte figures of a job that no longer matches the
 *    control, which is worse than showing nothing.
 *  - the footnote is read off the RESULT, not off the control, so the
 *    sentence under a JPG always describes the JPG that is actually there.
 *
 * The option list itself is checked against lib/limits.js rather than a list
 * written here — a radio group is a format list too, and the one place the
 * page could still offer an output the engine has stopped writing.
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

import HeicTool from '@/app/(tools)/heic/HeicTool';
import { formatFileSize } from '@/lib/format/bytes';
import { constraintsLine } from '@/lib/format/upload-helpers';
import { HEIC_INPUT_FORMATS, HEIC_OUTPUT_FORMATS } from '@/lib/limits';
import { blobOfSize, imageFile, installNetworkSentinel, setInputFiles } from '../helpers.jsx';

const ORIGINAL_BYTES = 2_400_000;

let network;

beforeEach(() => {
    network = installNetworkSentinel();
    processImageMock.mockReset();
    terminateWorkerMock.mockReset();
    vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
    network.restore();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/**
 * What the engine hands back for a HEIC job. The dimensions are the ones
 * libheif reported, which is the only place they can come from here — no
 * browser gives the page a HEIC preview to measure.
 */
function heicOutcome({ format = 'jpeg', bytes = 4_100_000 } = {}) {
    return {
        blob: blobOfSize(bytes, `image/${format}`),
        filename: `resizo-converted-photo.${format === 'jpeg' ? 'jpg' : format}`,
        format,
        width: 4032,
        height: 3024,
        originalBytes: ORIGINAL_BYTES,
        resultBytes: bytes,
        savedPercent: -71,
        qualityApplied: format === 'jpeg' ? 90 : null,
    };
}

/** Renders the tool and drops one HEIC on it, exactly as the picker would. */
async function dropPhoto(utils, file = imageFile('IMG_4021.heic', 'heic', { size: ORIGINAL_BYTES })) {
    const input = utils.container.querySelector('input[type="file"]');
    setInputFiles(input, [file]);
    fireEvent.change(input);
    await screen.findByText(file.name);
}

async function convert() {
    await userEvent.click(screen.getByRole('button', { name: /^Convert to/ }));
}

/** The FormData-derived options the engine was called with. */
function optionsSent() {
    return processImageMock.mock.calls[0][2];
}

describe('HeicTool — the output format control', () => {
    it('offers every HEIC output format and nothing else', () => {
        render(<HeicTool />);
        const radios = screen.getAllByRole('radio');

        expect(radios.map((radio) => radio.value)).toEqual([...HEIC_OUTPUT_FORMATS]);
    });

    it('puts the radios in one named group a keyboard can arrow through', () => {
        render(<HeicTool />);

        for (const radio of screen.getAllByRole('radio')) {
            expect(radio.name).toBe('heic-format');
        }
    });

    it('labels the choice with what it costs, not just the format token', () => {
        render(<HeicTool />);

        expect(screen.getByRole('radio', { name: 'JPG (smaller, opens everywhere)' })).toBeInTheDocument();
        expect(
            screen.getByRole('radio', { name: 'PNG (lossless, keeps transparency, much larger)' }),
        ).toBeInTheDocument();
    });

    it('groups them under one legend', () => {
        render(<HeicTool />);

        expect(screen.getByRole('group', { name: 'Save as' })).toBeInTheDocument();
    });
});

describe('HeicTool — JPG is what a page with no preset means', () => {
    it('starts on JPG and says so on the button', () => {
        render(<HeicTool />);

        expect(screen.getByRole('radio', { name: /^JPG/ })).toBeChecked();
        expect(screen.getByRole('radio', { name: /^PNG/ })).not.toBeChecked();
        expect(screen.getByRole('button', { name: 'Convert to JPG' })).toBeInTheDocument();
    });

    it('asks the engine for a JPEG, and uploads nothing', async () => {
        processImageMock.mockResolvedValue(heicOutcome());
        const utils = render(<HeicTool />);

        await dropPhoto(utils);
        await convert();

        await waitFor(() => expect(processImageMock).toHaveBeenCalledTimes(1));
        expect(processImageMock.mock.calls[0][0]).toBe('heic');
        expect(optionsSent().format).toBe('jpeg');
        expect(network.calls).toHaveLength(0);
    });
});

describe('HeicTool — the preset the /heic-to-png route hands over', () => {
    it('opens on PNG and labels the button for it', () => {
        render(<HeicTool preset={{ format: 'png' }} />);

        expect(screen.getByRole('radio', { name: /^PNG/ })).toBeChecked();
        expect(screen.getByRole('radio', { name: /^JPG/ })).not.toBeChecked();
        expect(screen.getByRole('button', { name: 'Convert to PNG' })).toBeInTheDocument();
    });

    it('asks the engine for a PNG', async () => {
        processImageMock.mockResolvedValue(heicOutcome({ format: 'png', bytes: 21_000_000 }));
        const utils = render(<HeicTool preset={{ format: 'png' }} />);

        await dropPhoto(utils);
        await convert();

        await waitFor(() => expect(processImageMock).toHaveBeenCalledTimes(1));
        expect(optionsSent().format).toBe('png');
    });

    it('preselects without locking — the visitor can still take the JPG', async () => {
        // A locked control here would be wrong for the reason /convert ships a
        // way out of its locked pair: someone who lands on /heic-to-png and
        // then wants the small file should not have to find another page.
        processImageMock.mockResolvedValue(heicOutcome());
        const utils = render(<HeicTool preset={{ format: 'png' }} />);

        const jpg = screen.getByRole('radio', { name: /^JPG/ });
        expect(jpg).toBeEnabled();

        await dropPhoto(utils);
        await userEvent.click(jpg);
        await convert();

        await waitFor(() => expect(processImageMock).toHaveBeenCalledTimes(1));
        expect(optionsSent().format).toBe('jpeg');
    });
});

describe('HeicTool — changing the format after a run', () => {
    it('throws the finished result away rather than leaving it under the new choice', async () => {
        processImageMock.mockResolvedValue(heicOutcome());
        const utils = render(<HeicTool />);

        await dropPhoto(utils);
        await convert();
        await screen.findByRole('button', { name: 'Download JPG' });

        await userEvent.click(screen.getByRole('radio', { name: /^PNG/ }));

        expect(screen.queryByRole('button', { name: /^Download/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'Convert to PNG' })).toBeInTheDocument();
    });

    it('keeps the file, so the visitor does not have to find it again', async () => {
        processImageMock.mockResolvedValue(heicOutcome());
        const utils = render(<HeicTool />);

        await dropPhoto(utils);
        await convert();
        await screen.findByRole('button', { name: 'Download JPG' });

        await userEvent.click(screen.getByRole('radio', { name: /^PNG/ }));

        expect(screen.getByText('IMG_4021.heic')).toBeInTheDocument();
    });
});

describe('HeicTool — the result says what it actually is', () => {
    it('offers the JPG download and the JPG footnote', async () => {
        processImageMock.mockResolvedValue(heicOutcome());
        const utils = render(<HeicTool />);

        await dropPhoto(utils);
        await convert();

        await screen.findByRole('button', { name: 'Download JPG' });
        expect(
            screen.getByText(/A JPG is normally larger than the HEIC it came from/),
        ).toHaveTextContent('Converted at quality 90.');
    });

    it('offers the PNG download and the PNG footnote, with no quality claim', async () => {
        processImageMock.mockResolvedValue(heicOutcome({ format: 'png', bytes: 21_000_000 }));
        const utils = render(<HeicTool preset={{ format: 'png' }} />);

        await dropPhoto(utils);
        await convert();

        await screen.findByRole('button', { name: 'Download PNG' });
        const footnote = screen.getByText(/A PNG stores every decoded pixel exactly/);

        expect(footnote).toHaveTextContent('No quality setting applies.');
        expect(footnote).not.toHaveTextContent('quality 90');
    });

    it('describes the preview as the format that came back, for a screen reader', async () => {
        processImageMock.mockResolvedValue(heicOutcome({ format: 'png', bytes: 21_000_000 }));
        const utils = render(<HeicTool preset={{ format: 'png' }} />);

        await dropPhoto(utils);
        await convert();

        await screen.findByRole('button', { name: 'Download PNG' });
        expect(screen.getByAltText('PNG copy of IMG_4021.heic')).toBeInTheDocument();
    });
});

describe('HeicTool — what the format choice must not change', () => {
    it('still takes HEIC and nothing else', () => {
        render(<HeicTool />);

        expect(screen.getByText(constraintsLine({ formats: HEIC_INPUT_FORMATS }))).toBeInTheDocument();
    });

    it('still explains why there is no thumbnail once a file is chosen', async () => {
        const utils = render(<HeicTool />);

        await dropPhoto(utils);

        expect(
            screen.getByText('No browser can display a HEIC file, so there is no preview until it is converted.'),
        ).toBeInTheDocument();
    });

    it('still hands the gate unknown dimensions rather than a made-up zero', async () => {
        // Zero would trip the "dimensions could not be read" refusal and turn
        // every iPhone photo away; null defers until libheif reports the real
        // size. The format control must not have quietly changed that.
        processImageMock.mockResolvedValue(heicOutcome());
        const utils = render(<HeicTool />);

        await dropPhoto(utils);
        await convert();

        await waitFor(() => expect(processImageMock).toHaveBeenCalledTimes(1));
        const options = optionsSent();

        expect(options.sourceWidth ?? null).toBeNull();
        expect(options.sourceHeight ?? null).toBeNull();
    });

    it('still hands over the size it read at intake, for a result that can print it', async () => {
        // The engine's own count wins when it has one, so the outcome omits it
        // here — leaving the page's `entry.size` as the only place the figure
        // on the panel could have come from.
        processImageMock.mockResolvedValue({ ...heicOutcome(), originalBytes: 0 });
        const utils = render(<HeicTool />);

        await dropPhoto(utils);
        await convert();

        await screen.findByRole('button', { name: 'Download JPG' });
        expect(screen.getByText(formatFileSize(ORIGINAL_BYTES))).toBeInTheDocument();
    });

    it('still lets go of the codec heaps when the page unmounts', async () => {
        processImageMock.mockResolvedValue(heicOutcome());
        const utils = render(<HeicTool />);

        await dropPhoto(utils);
        utils.unmount();

        expect(terminateWorkerMock).toHaveBeenCalledTimes(1);
    });
});
