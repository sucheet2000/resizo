/**
 * /resize — changing a setting must not throw.
 *
 * THIS FILE EXISTS BECAUSE OF A LIVE CRASH THAT SHIPPED.
 *
 * PR #25 gave four tools a `submit.reset()` on every settings control, so that
 * changing a setting after a result brings the submit button back. In
 * CompressTool, CropTool, ConvertTool and JpgToPdfTool the local hook really is
 * called `submit`. ResizeTool names its two hooks `singleSubmit` and
 * `bulkResize` — and the helper was pasted in un-renamed:
 *
 *     const clearsResult = (apply) => (...args) => {
 *         submit.reset();          // <- not defined in this file
 *         return apply(...args);
 *     };
 *
 * Every width, height, scale, format, preset and ratio-lock change on the
 * busiest route on the site threw a ReferenceError. The whole suite stayed
 * green because NOTHING rendered ResizeTool and changed a setting — the only
 * file that rendered it at all exercised the folder picker.
 *
 * Copy drift with a bug in exactly one copy, invisible to a suite that had
 * never touched that path. So the assertion here is not clever: render the
 * tool, move a control, and require that it does not explode.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/image-client/client', () => ({
    processImage: vi.fn(),
    terminateWorker: vi.fn(),
}));

import ResizeTool from '@/app/(tools)/resize/ResizeTool';
import { imageFile, setInputFiles, stubImageProbe } from '../helpers';

let probe;

beforeEach(() => {
    probe = stubImageProbe({ width: 1200, height: 800 });
});

afterEach(() => {
    probe.restore();
    window.location.hash = '';
    vi.restoreAllMocks();
});

async function withImage() {
    const view = render(<ResizeTool />);
    const input = view.container.querySelector('input[type="file"]');
    setInputFiles(input, [imageFile('photo.jpg', 'jpeg', { size: 500_000 })]);
    await act(async () => {
        input.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    return view;
}

describe('/resize single — every settings control', () => {
    it('accepts a width without throwing', async () => {
        await withImage();

        await act(async () => {
            fireEvent.change(screen.getByRole('spinbutton', { name: /^width \(px\)$/i }), {
                target: { value: '640' },
            });
        });

        expect(screen.getByRole('spinbutton', { name: /^width \(px\)$/i })).toHaveValue(640);
    });

    it('accepts a height without throwing', async () => {
        await withImage();

        await act(async () => {
            fireEvent.change(screen.getByRole('spinbutton', { name: /^height \(px\)$/i }), {
                target: { value: '480' },
            });
        });

        expect(screen.getByRole('spinbutton', { name: /^height \(px\)$/i })).toHaveValue(480);
    });

    it('accepts an output format without throwing', async () => {
        await withImage();
        const select = screen.getByLabelText(/output format/i);

        await act(async () => {
            fireEvent.change(select, { target: { value: 'webp' } });
        });

        expect(select).toHaveValue('webp');
    });
});
