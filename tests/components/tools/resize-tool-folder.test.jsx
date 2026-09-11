/**
 * /resize, bulk tab — picking a folder.
 *
 * The pieces are proved on their own elsewhere (lib/upload/folder-select.js,
 * useImageUpload.selectFolder, the Dropzone control). What is asserted here is
 * that they are actually wired together on the page a person uses: the control
 * is on the bulk path only, a folder of mixed files produces the right images
 * and a truthful sentence, and the sentence is a status rather than an error.
 *
 * The engine is mocked at its module boundary — no Worker is constructed.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/image-client/client', () => ({
    processImage: vi.fn(),
    terminateWorker: vi.fn(),
}));

import ResizeTool from '@/app/(tools)/resize/ResizeTool';
import { imageFile, setInputFiles, stubImageProbe } from '../helpers';

let probe;
let restoreFolderSupport;

beforeEach(() => {
    probe = stubImageProbe({ width: 1200, height: 800 });
    // jsdom has no webkitdirectory; a real browser does. This is the supported
    // browser, created the same way the browser creates it.
    Object.defineProperty(window.HTMLInputElement.prototype, 'webkitdirectory', {
        value: false,
        configurable: true,
        writable: true,
    });
    restoreFolderSupport = () => { delete window.HTMLInputElement.prototype.webkitdirectory; };
    window.location.hash = '#bulk';
});

afterEach(() => {
    probe.restore();
    restoreFolderSupport();
    window.location.hash = '';
});

/** An imageFile placed on a path, the way a directory pick reports one. */
function atPath(path, format = 'jpeg', options = {}) {
    const file = imageFile(path.split('/').pop(), format, options);
    Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true });
    return file;
}

async function pickFolder(container, files) {
    const input = container.querySelector('#bulk-file-folder');
    setInputFiles(input, files);
    await act(async () => {
        input.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    return input;
}

describe('/resize bulk — the folder control', () => {
    it('sits beside the file picker, not instead of it', () => {
        render(<ResizeTool />);

        expect(screen.getByRole('button', { name: 'Choose images' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Choose a folder' })).toBeInTheDocument();
    });

    it('is not offered on the single-image tab', () => {
        window.location.hash = '';
        render(<ResizeTool />);

        expect(screen.getByRole('button', { name: 'Choose an image' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Choose a folder' })).toBeNull();
    });

    it('takes the images out of a mixed folder and says what it found', async () => {
        const { container } = render(<ResizeTool />);

        await pickFolder(container, [
            atPath('Trip/photo.jpg', 'jpeg'),
            atPath('Trip/logo.png', 'png'),
            // A PDF wearing a .jpg name. The bytes decide.
            atPath('Trip/invoice.jpg', 'other'),
        ]);

        expect(screen.getByText('photo.jpg')).toBeInTheDocument();
        expect(screen.getByText('logo.png')).toBeInTheDocument();
        expect(screen.queryByText('invoice.jpg')).toBeNull();

        const notice = screen.getByRole('status');
        expect(notice).toHaveTextContent('Added 2 images from that folder.');
        expect(notice).toHaveTextContent('1 other file in there is not an image this tool reads.');
        // A count is not a failure.
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('adds the first twenty of a big folder and says so, rather than refusing it', async () => {
        const { container } = render(<ResizeTool />);
        const files = Array.from({ length: 60 }, (_, index) =>
            atPath(`Trip/${String(index).padStart(3, '0')}.jpg`, 'jpeg', { size: 1000 }));

        await pickFolder(container, files);

        const notice = screen.getByRole('status');
        expect(notice).toHaveTextContent('That folder has 60 images.');
        expect(notice).toHaveTextContent('The first 20 by name were added');
        expect(notice).toHaveTextContent('one batch takes up to 20 images and 80 MB in total');
        expect(notice).toHaveTextContent('the other 40 were left out');

        expect(screen.getByRole('button', { name: 'Resize 20 images' })).toBeEnabled();
    });

    it('says plainly when a folder holds nothing this tool can read', async () => {
        const { container } = render(<ResizeTool />);

        await pickFolder(container, [atPath('Work/report.pdf', 'other')]);

        // The exact list is RESIZE_INPUT_FORMATS's own prose (now four formats
        // with AVIF's addition) — matched loosely so this assertion does not
        // itself re-type the registry.
        expect(screen.getByRole('status')).toHaveTextContent(/No .*images were found in that folder\./);
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
