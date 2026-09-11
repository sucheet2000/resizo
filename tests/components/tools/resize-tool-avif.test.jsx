/**
 * /resize + AVIF.
 *
 * The format select derives from ALLOWED_OUTPUT_FORMATS (lib/limits.js),
 * which already carries 'avif' for real, so most of this needs no mock. The
 * one exception is dropping an actual AVIF file: RESIZE_INPUT_FORMATS also
 * already carries 'avif', so useImageUpload's intake gate calls the real
 * canDecodeAvif() — which does not exist yet in lib/image-client/capability.js,
 * a concurrent change on this same branch. That one test mocks it.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { processImageMock } = vi.hoisted(() => ({ processImageMock: vi.fn() }));

vi.mock('@/lib/image-client/client', () => ({
    processImage: processImageMock,
    terminateWorker: vi.fn(),
}));

vi.mock('@/lib/image-client/capability', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, canDecodeAvif: vi.fn().mockResolvedValue(true) };
});

import ResizeTool from '@/app/(tools)/resize/ResizeTool';
import { ALLOWED_OUTPUT_FORMATS } from '@/lib/limits';
import { imageFile, setInputFiles, stubImageProbe } from '../helpers';

let probe;

beforeEach(() => {
    probe = stubImageProbe({ width: 1200, height: 800 });
    processImageMock.mockReset();
});

afterEach(() => {
    probe.restore();
    vi.restoreAllMocks();
});

async function withFile(file) {
    const view = render(<ResizeTool />);
    const input = view.container.querySelector('input[type="file"]');
    setInputFiles(input, [file]);
    await act(async () => {
        input.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    return view;
}

describe('/resize — the output format select', () => {
    it('lists AVIF, derived from ALLOWED_OUTPUT_FORMATS rather than hand-typed', () => {
        expect(ALLOWED_OUTPUT_FORMATS, 'this suite has nothing to prove once the registry moves on').toContain('avif');

        render(<ResizeTool />);
        const options = Array.from(screen.getByLabelText(/output format/i).options).map((o) => o.value);

        expect(options).toEqual(['original', ...ALLOWED_OUTPUT_FORMATS]);
    });
});

describe('/resize — the AVIF quality note', () => {
    it('appears once AVIF is chosen directly, since this tool has no quality dial', async () => {
        await withFile(imageFile('photo.jpg', 'jpeg', { size: 500_000 }));

        await act(async () => {
            const select = screen.getByLabelText(/output format/i);
            select.value = 'avif';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });

        expect(screen.getByText(/no dial for it on this tool yet/i)).toBeInTheDocument();
    });

    it('stays away for an ordinary format', async () => {
        await withFile(imageFile('photo.jpg', 'jpeg', { size: 500_000 }));

        expect(screen.queryByText(/no dial for it on this tool yet/i)).toBeNull();
    });

    it('follows "Same as the original" resolving to AVIF for an AVIF source', async () => {
        await withFile(imageFile('photo.avif', 'avif', { size: 500_000 }));

        expect(screen.getByText(/no dial for it on this tool yet/i)).toBeInTheDocument();
    });
});

describe('/resize — "Same as the original" on an AVIF source', () => {
    it('submits format "avif" to the engine without the visitor touching the format control', async () => {
        processImageMock.mockResolvedValue({
            blob: new Blob([new Uint8Array(1000)], { type: 'image/avif' }),
            filename: 'resizo-resized-photo.avif',
            format: 'avif',
            width: 1200,
            height: 800,
            originalBytes: 500_000,
            resultBytes: 1000,
        });

        await withFile(imageFile('photo.avif', 'avif', { size: 500_000 }));
        await userEvent.click(screen.getByRole('button', { name: /^Resize image$/ }));

        expect(processImageMock).toHaveBeenCalledTimes(1);
        expect(processImageMock.mock.calls[0][2].format).toBe('avif');
    });
});
