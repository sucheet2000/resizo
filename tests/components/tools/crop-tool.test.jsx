/**
 * /crop — what the panel says after the crop has run.
 *
 * Two defects lived here, both of them in the gap between "the job finished"
 * and "the four rectangle fields are still mounted and enabled".
 *
 *  1. The result panel was fed `width={rect.width} height={rect.height}` — the
 *     LIVE form — instead of the dimensions the engine returned. Typing in the
 *     Width field after a result silently rewrote the reported Size of a file
 *     that had already been produced from different numbers. The blob behind
 *     the Download button was always correct; the label lied about it.
 *
 *  2. Editing the rectangle did not clear the result, and ToolShell removes the
 *     submit action while a result exists. So the visitor could change the crop
 *     and have nothing on screen able to run it — and on /crop the dropzone has
 *     been replaced by a preview card by then, so the only way out was "Start
 *     over", which throws the source file away.
 *
 * useLocalProcess is stubbed, as it is for the other tool tests: what is under
 * test is what the page displays and when it offers to run, not the codecs.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CropTool from '@/app/(tools)/crop/CropTool';
import { imageFile, setInputFiles, stubImageProbe } from '../helpers';

const harness = vi.hoisted(() => ({
    submit: null,
    setResult: null,
}));

vi.mock('@/lib/hooks/useLocalProcess', async () => {
    const { useState } = await import('react');

    return {
        default: function useStubbedProcess() {
            const [result, setResult] = useState(null);
            harness.setResult = setResult;

            return {
                submit: (...args) => harness.submit(...args),
                download: () => {},
                reset: () => setResult(null),
                cancel: () => {},
                isProcessing: false,
                progress: 0,
                error: null,
                result,
                setError: () => {},
                phase: null,
                suggestion: null,
            };
        },
    };
});

let probe;

beforeEach(() => {
    probe = stubImageProbe({ width: 1200, height: 800 });
    harness.submit = vi.fn();
    harness.setResult = null;
});

afterEach(() => {
    probe.restore();
});

/** The engine's answer: the crop it actually performed. */
const CROPPED = {
    blob: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }),
    filename: 'resizo-cropped-photo.jpg',
    format: 'jpeg',
    sourceFormat: 'jpeg',
    width: 1200,
    height: 800,
    originalBytes: 500 * 1024,
    resultBytes: 1024,
};

async function withResult(payload = CROPPED) {
    const view = render(<CropTool />);

    const input = document.getElementById('crop-file');
    setInputFiles(input, [imageFile('photo.jpg', 'jpeg', { size: 500 * 1024 })]);
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await act(async () => harness.setResult(payload));
    return view;
}

const widthField = () => screen.getByRole('spinbutton', { name: /^width$/i });
const submitButton = () => screen.queryByRole('button', { name: /^crop image$/i });

describe('the size reported after a crop', () => {
    /**
     * Scoped to the result panel's own "Size" row on purpose. The overlay and
     * the "Keeping …" line are supposed to track the form live — that is what
     * makes the rectangle previewable. The result panel is the one place that
     * must describe the file already sitting behind the Download button.
     */
    function reportedSize(container) {
        const term = [...container.querySelectorAll('dt')].find(
            (node) => node.textContent.trim() === 'Size',
        );
        return term?.nextElementSibling?.textContent;
    }

    /**
     * The two fixes interact, which is worth stating because it changes how
     * this is tested. Now that editing the rectangle clears the result, the
     * panel unmounts before it can go stale — so the original reproduction
     * ("type 400 and watch the Size follow") no longer reaches the bug.
     *
     * The property still worth pinning is the one that does not depend on that:
     * the panel must describe the FILE, so its numbers must come from the
     * result even when the form says something else. Handing back a crop whose
     * dimensions differ from the rectangle on screen proves which one is read,
     * and keeps working if the reset behaviour ever changes.
     */
    it('reads its numbers from the result, not from the rectangle on screen', async () => {
        const { container } = await withResult({ ...CROPPED, width: 640, height: 480 });

        expect(widthField(), 'the form still holds the full-image rectangle').toHaveValue(1200);
        expect(
            reportedSize(container),
            'the panel reported the form rectangle instead of the crop that ran',
        ).toBe('640×480');
    });
});

describe('editing the rectangle after a crop', () => {
    it('brings the submit action back', async () => {
        await withResult();
        expect(submitButton(), 'precondition: the action is hidden while a result is shown').toBeNull();

        await act(async () => {
            fireEvent.change(widthField(), { target: { value: '400' } });
        });

        expect(
            submitButton(),
            'changed the crop with no control on screen able to run it',
        ).toBeInTheDocument();
    });
});
