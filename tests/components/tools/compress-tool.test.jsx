/**
 * /compress — the PNG decision, at the surface a visitor actually touches.
 *
 * The engine side is proved in tests/lib/image-client/compress-target.test.js
 * against the real codecs. What is asserted here is the half that decides
 * whether the product is honest: that a PNG which cannot do what was asked is
 * TOLD to the person before they wait for it, that the way out is one tap, that
 * declining still produces a full-size file rather than a thumbnail, and that
 * none of this is claimed on the server lane, where the limitation is not real.
 *
 * useLocalFirstProcess is the seam and is stubbed here on purpose: the point of
 * these tests is what the page says and posts, not what the codecs return.
 * `canProcessLocally` is stubbed alongside it because it is the page's own
 * source of truth for "will this run here" — the two have to move together.
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CompressTool from '@/app/(tools)/compress/CompressTool';
import { imageFile, setInputFiles, stubImageProbe } from '../helpers';

const harness = vi.hoisted(() => ({
    canProcessLocally: null,
    submit: null,
    setResult: null,
}));

vi.mock('@/lib/hooks/useLocalFirstProcess', async () => {
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
                lane: 'local',
                phase: null,
                suggestion: null,
            };
        },
        canProcessLocally: (...args) => harness.canProcessLocally(...args),
    };
});

let probe;

beforeEach(() => {
    probe = stubImageProbe({ width: 1200, height: 800 });
    harness.canProcessLocally = vi.fn(() => true);
    harness.submit = vi.fn();
    harness.setResult = null;
});

afterEach(() => {
    probe.restore();
});

/** Drops one file on the tool and waits for the dimension probe to settle. */
async function upload(file) {
    const input = document.getElementById('compress-file');
    setInputFiles(input, [file]);
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function pngFile() {
    return imageFile('screenshot.png', 'png', { size: 499 * 1024 });
}

function jpegFile() {
    return imageFile('photo.jpg', 'jpeg', { size: 2_400_000 });
}

function offer() {
    return screen.queryByRole('button', { name: /save it as webp instead/i });
}

function qualitySlider() {
    return screen.getByRole('slider', { name: /quality/i });
}

function chooseMode(name) {
    return userEvent.click(screen.getByRole('radio', { name }));
}

/** Whatever the page most recently handed the seam. */
function lastForm() {
    return harness.submit.mock.calls.at(-1)?.[0];
}

describe('a PNG asked for an exact size is offered WebP before it runs', () => {
    it('says what PNG cannot do and what WebP can, naming the size and the dimensions', async () => {
        render(<CompressTool preset={{ targetKb: 20 }} />);
        await upload(pngFile());

        const note = screen.getByRole('status');
        expect(note).toHaveTextContent(/PNG is lossless and nothing here can reduce its colours/i);
        // The honest reason, not a vague apology.
        expect(note).toHaveTextContent(/shrink the picture/i);
        expect(note).toHaveTextContent(/20 KB/);
        expect(note).toHaveTextContent(/1200×800/);
        expect(within(note).getByRole('button', { name: /save it as webp instead/i })).toBeInTheDocument();
    });

    it('switches the output format in one tap and says what it will now do', async () => {
        const user = userEvent.setup();
        render(<CompressTool preset={{ targetKb: 20 }} />);
        await upload(pngFile());

        await user.click(offer());

        expect(offer()).toBeNull();
        const note = screen.getByRole('status');
        expect(note).toHaveTextContent(/Saving as WebP at the original dimensions/i);
        expect(within(note).getByRole('button', { name: /keep png instead/i })).toBeInTheDocument();
    });

    it('posts the chosen format with the target once it has been accepted', async () => {
        const user = userEvent.setup();
        render(<CompressTool preset={{ targetKb: 20 }} />);
        await upload(pngFile());

        await user.click(offer());
        await user.click(screen.getByRole('button', { name: /^compress image$/i }));

        const form = lastForm();
        expect(form.get('output_format')).toBe('webp');
        expect(form.get('targetBytes')).toBe(String(20 * 1024));
        expect(harness.submit.mock.calls.at(-1)[1]).toMatchObject({ sourceWidth: 1200, sourceHeight: 800 });
    });

    it('takes the offer back out again, and stops posting the format', async () => {
        const user = userEvent.setup();
        render(<CompressTool preset={{ targetKb: 20 }} />);
        await upload(pngFile());

        await user.click(offer());
        await user.click(screen.getByRole('button', { name: /keep png instead/i }));
        await user.click(screen.getByRole('button', { name: /^compress image$/i }));

        expect(lastForm().has('output_format')).toBe(false);
        expect(offer()).not.toBeNull();
    });

    it('still runs the PNG when the offer is declined — the button is never blocked', async () => {
        const user = userEvent.setup();
        render(<CompressTool preset={{ targetKb: 20 }} />);
        await upload(pngFile());

        const button = screen.getByRole('button', { name: /^compress image$/i });
        expect(button).toBeEnabled();

        await user.click(button);
        expect(lastForm().get('targetBytes')).toBe(String(20 * 1024));
        expect(lastForm().has('output_format')).toBe(false);
    });

    it('waits for a real target before quoting one back', async () => {
        const user = userEvent.setup();
        render(<CompressTool preset={{ targetKb: 20 }} />);
        await upload(pngFile());

        const target = screen.getByRole('spinbutton', { name: /target size/i });
        await user.clear(target);

        // Nothing to quote yet, so nothing is offered.
        expect(offer()).toBeNull();

        await user.type(target, '40');
        expect(screen.getByRole('status')).toHaveTextContent(/40 KB/);
    });

    it('does not offer anything for a format that can reach a target on its own', async () => {
        render(<CompressTool preset={{ targetKb: 20 }} />);
        await upload(jpegFile());

        expect(offer()).toBeNull();
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('makes no claim about PNG when the work will happen on the server', async () => {
        harness.canProcessLocally = vi.fn(() => false);
        render(<CompressTool preset={{ targetKb: 20 }} />);
        await upload(pngFile());

        // The server still has a quantiser, so the limitation is not real there
        // and the page must not invent it.
        expect(offer()).toBeNull();
        expect(screen.queryByRole('status')).toBeNull();
    });
});

describe('the PNG quality slider does not pretend to work', () => {
    it('is disabled and explains itself', async () => {
        render(<CompressTool />);
        await upload(pngFile());

        expect(qualitySlider()).toBeDisabled();
        expect(screen.getByText(/PNG is lossless here, so this dial is off/i)).toBeInTheDocument();
    });

    it('offers the format that does have a working dial', async () => {
        const user = userEvent.setup();
        render(<CompressTool />);
        await upload(pngFile());

        expect(screen.getByRole('status')).toHaveTextContent(/this slider cannot change the file size/i);

        await user.click(offer());
        expect(qualitySlider()).toBeEnabled();
    });

    it('leaves the slider alone for a JPEG', async () => {
        render(<CompressTool />);
        await upload(jpegFile());

        expect(qualitySlider()).toBeEnabled();
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('leaves the slider alone for a PNG bound for the server', async () => {
        harness.canProcessLocally = vi.fn(() => false);
        render(<CompressTool />);
        await upload(pngFile());

        expect(qualitySlider()).toBeEnabled();
    });
});

describe('a missed target is announced, never dressed up as a hit', () => {
    const missedResult = {
        blob: new Blob([new Uint8Array(8)], { type: 'image/png' }),
        filename: 'resizo-compressed-screenshot.png',
        format: 'png',
        sourceFormat: 'png',
        width: 1200,
        height: 800,
        originalBytes: 499 * 1024,
        resultBytes: 212 * 1024,
        targetBytes: 20 * 1024,
        targetMet: false,
        scalePercent: 100,
    };

    async function showResult(payload) {
        render(<CompressTool preset={{ targetKb: 20 }} />);
        await upload(pngFile());
        await act(async () => harness.setResult(payload));
    }

    it('says the target was not met, and offers the format that would meet it', async () => {
        await showResult(missedResult);

        const notices = screen.getAllByRole('status');
        const miss = notices.find((node) => /target was not met/i.test(node.textContent));
        expect(miss).toBeDefined();
        expect(miss).toHaveTextContent(/20 KB target was not met/i);
        expect(miss).toHaveTextContent(/1200×800/);
        expect(within(miss).getByRole('button', { name: /save it as webp instead/i })).toBeInTheDocument();
    });

    it('states the full dimensions it kept rather than the size it did not reach', async () => {
        await showResult(missedResult);

        expect(screen.getByText(/does not go below/i)).toHaveTextContent(/1200×800/);
        expect(screen.getByText(/does not go below/i)).toHaveTextContent(/rather than shrunk to fake a hit/i);
        // The panel prints the dimensions it actually produced.
        expect(screen.getByText('1200×800')).toBeInTheDocument();
    });

    it('says nothing of the kind when the target was met', async () => {
        await showResult({ ...missedResult, resultBytes: 19 * 1024, targetMet: true });

        expect(screen.queryByText(/target was not met/i)).toBeNull();
        expect(screen.getByText(/Asked for 20 KB/i)).toHaveTextContent(/landed on 19 KB/i);
    });

    it('says nothing of the kind on the server lane, which reports no such field', async () => {
        const { targetMet, ...serverShape } = missedResult;
        await showResult(serverShape);

        expect(screen.queryByText(/target was not met/i)).toBeNull();
    });

    it('names the new format when the output was switched', async () => {
        await showResult({
            ...missedResult,
            format: 'webp',
            resultBytes: 19 * 1024,
            targetMet: true,
            targetBytes: null,
        });

        expect(screen.getByText(/Saved as WebP at the original dimensions/i)).toBeInTheDocument();
    });
});
