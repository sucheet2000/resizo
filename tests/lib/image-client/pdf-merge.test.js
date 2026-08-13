/**
 * /merge-pdf, the engine.
 *
 * The tool is worth building for one reason: every competitor that offers it
 * uploads the file, and the files people merge are contracts, bank statements
 * and scans of an ID. So the claim is the product, and the claim is only worth
 * anything if the failures are honest — a merge that silently produces blank
 * pages, or one that carries a stranger's name into the output, is worse than
 * no tool at all.
 *
 * FIVE THINGS THIS FILE EXISTS TO STOP
 *
 *  1. PAGES ARRIVING IN THE WRONG ORDER, OR THE WRONG PAGES ARRIVING. Order is
 *     the entire feature. It is asserted by giving every source page a MediaBox
 *     nothing else has, so the finished document can be read back and the pages
 *     identified individually rather than merely counted.
 *
 *  2. A PAGE LOSING ITS SHAPE. A scanner writes a page turned 90 degrees and
 *     records the turn as page rotation; a reader that never applies it shows
 *     the scan on its side. Both the size and the rotation are checked on the
 *     way out, because copyPages carrying one and dropping the other would look
 *     fine in a page count.
 *
 *  3. A PASSWORD-PROTECTED FILE BEING "MERGED". pdf-lib's own error message
 *     suggests ignoreEncryption, and that flag produces a document whose pages
 *     are encrypted garbage — measured below, not assumed. The refusal has to
 *     name the password.
 *
 *  4. SOMEBODY ELSE'S NAME RIDING INTO THE OUTPUT. A PDF's Info dictionary
 *     holds the author, the title and the name of the machine that made it.
 *     This is the same guarantee the image tools make about EXIF, kept in the
 *     one place a document can break it.
 *
 *  5. THE MEMORY GATE BEING TOLD THIS JOB IS AN IMAGE JOB. Merging decodes
 *     nothing, so charging it a pixel surface would refuse a pile of scans that
 *     costs the tab almost nothing.
 *
 * Every fixture is built by pdf-lib itself, so the bytes under test are real
 * PDFs rather than hand-rolled approximations of one.
 */
import zlib from 'node:zlib';

import { beforeAll, describe, expect, it } from 'vitest';

import { MAX_BULK_FILES, MAX_BULK_TOTAL_BYTES } from '@/lib/constants';
import {
    assessPdfMergeJob,
    deviceBudgetBytes,
    estimatePdfMergePeakBytes,
    estimatePeakBytes,
    PDF_DOCUMENT_COPIES,
    PDF_MERGE_SOURCE_COPIES,
    WASM_BASELINE_BYTES,
} from '@/lib/image-client/capability';
import { isPdfSignature } from '@/lib/image/magic-bytes';

let runOperation;
let JobError;
let mergePdfs;
let parseMergePlan;
let parsePageRange;
let readPdfPageCount;
let MERGE_PRODUCER;
let PDFDocument;
let degrees;

beforeAll(async () => {
    ({ runOperation, JobError } = await import('@/lib/image-client/operations'));
    ({
        mergePdfs,
        parseMergePlan,
        parsePageRange,
        readPdfPageCount,
        MERGE_PRODUCER,
    } = await import('@/lib/image-client/pdf-merge'));
    ({ PDFDocument, degrees } = await import('@cantoo/pdf-lib'));
}, 60_000);

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/**
 * A real PDF whose pages are individually identifiable.
 *
 * Each page gets a MediaBox width no other page in the test has, which is what
 * makes an ORDER assertion possible: a page count proves nothing about which
 * page landed where, and reading the width back names the page exactly.
 */
async function makePdf({ pages, metadata = null } = {}) {
    const pdf = await PDFDocument.create();

    for (const page of pages) {
        const sheet = pdf.addPage([page.width, page.height ?? 500]);
        if (page.rotation) sheet.setRotation(degrees(page.rotation));
    }

    if (metadata) {
        if (metadata.title !== undefined) pdf.setTitle(metadata.title);
        if (metadata.author !== undefined) pdf.setAuthor(metadata.author);
        if (metadata.subject !== undefined) pdf.setSubject(metadata.subject);
        if (metadata.producer !== undefined) pdf.setProducer(metadata.producer);
        if (metadata.creator !== undefined) pdf.setCreator(metadata.creator);
    }

    return Buffer.from(await pdf.save());
}

/** Widths, in page order — the identity of every page in the finished file. */
async function widthsOf(blob) {
    const loaded = await PDFDocument.load(Buffer.from(await blob.arrayBuffer()), { updateMetadata: false });
    return loaded.getPages().map((page) => Math.round(page.getWidth()));
}

async function pageShapesOf(blob) {
    const loaded = await PDFDocument.load(Buffer.from(await blob.arrayBuffer()), { updateMetadata: false });
    return loaded.getPages().map((page) => ({
        width: Math.round(page.getWidth()),
        height: Math.round(page.getHeight()),
        rotation: page.getRotation().angle,
    }));
}

/**
 * The output's own Info dictionary.
 *
 * `updateMetadata: false` matters and is not a detail: the loader's default is
 * to stamp its own Producer and ModDate onto whatever it opens, so reading a
 * document back with the default would report pdf-lib's Producer no matter what
 * the file on disk actually says — and the leak this suite is checking for would
 * be invisible in both directions.
 */
async function metadataOf(blob) {
    const loaded = await PDFDocument.load(Buffer.from(await blob.arrayBuffer()), { updateMetadata: false });
    return {
        title: loaded.getTitle(),
        author: loaded.getAuthor(),
        subject: loaded.getSubject(),
        producer: loaded.getProducer(),
        creator: loaded.getCreator(),
    };
}

function fileOf(bytes, name = 'document.pdf') {
    return new File([bytes], name, { type: 'application/pdf' });
}

function sourcesOf(...entries) {
    return entries.map(([bytes, name]) => ({ source: bytes, name }));
}

/** A file with a PDF header and nothing behind it that a parser can use. */
function corruptPdf() {
    return Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(400, 0x41)]);
}

/**
 * A PDF with an empty page tree. Written by hand because the writer will not
 * produce one — saving a document with no pages inserts a blank A4 sheet, which
 * is the writer being helpful and not the file people actually run into.
 */
function zeroPagePdf() {
    return Buffer.from([
        '%PDF-1.4',
        '1 0 obj', '<< /Type /Catalog /Pages 2 0 R >>', 'endobj',
        '2 0 obj', '<< /Type /Pages /Kids [] /Count 0 >>', 'endobj',
        'trailer', '<< /Size 3 /Root 1 0 R >>', '%%EOF', '',
    ].join('\n'));
}

async function encryptedPdf(password = 'letmein') {
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 400]);
    pdf.encrypt({ userPassword: password, ownerPassword: `${password}-owner` });
    return Buffer.from(await pdf.save());
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);

const MEGABYTE = 1024 * 1024;

/* ------------------------------------------------------------------ *
 * The signature
 * ------------------------------------------------------------------ */

describe('a file is accepted for what its bytes say it is', () => {
    it('recognises a real PDF', async () => {
        expect(isPdfSignature(await makePdf({ pages: [{ width: 300 }] }))).toBe(true);
    });

    it('refuses a PNG, whatever it is called', () => {
        expect(isPdfSignature(PNG_BYTES)).toBe(false);
    });

    it('refuses a header that is not at the very start', () => {
        // Readers tolerate junk before %PDF- and that tolerance is how a
        // polyglot gets in. Nothing here searches for the header.
        expect(isPdfSignature(Buffer.concat([Buffer.from('  \n'), Buffer.from('%PDF-1.7')]))).toBe(false);
    });

    it('never throws on short or empty input', () => {
        expect(isPdfSignature(Buffer.from([0x25]))).toBe(false);
        expect(isPdfSignature(Buffer.alloc(0))).toBe(false);
        expect(isPdfSignature(null)).toBe(false);
    });
});

/* ------------------------------------------------------------------ *
 * Merging
 * ------------------------------------------------------------------ */

describe('several PDFs become one', () => {
    it('puts every page of every file in, in the order the files were given', async () => {
        const first = await makePdf({ pages: [{ width: 101 }, { width: 102 }] });
        const second = await makePdf({ pages: [{ width: 201 }, { width: 202 }, { width: 203 }] });

        const merged = await mergePdfs({ sources: sourcesOf([first, 'a.pdf'], [second, 'b.pdf']) });

        expect(merged.pageCount).toBe(5);
        expect(await widthsOf(merged.blob)).toEqual([101, 102, 201, 202, 203]);
    });

    it('follows the order of the files, not their size or their name', async () => {
        const first = await makePdf({ pages: [{ width: 101 }] });
        const second = await makePdf({ pages: [{ width: 201 }, { width: 202 }] });

        const merged = await mergePdfs({ sources: sourcesOf([second, 'z.pdf'], [first, 'a.pdf']) });

        expect(await widthsOf(merged.blob)).toEqual([201, 202, 101]);
    });

    it('reports how many pages each source had', async () => {
        const first = await makePdf({ pages: [{ width: 101 }] });
        const second = await makePdf({ pages: [{ width: 201 }, { width: 202 }] });

        const merged = await mergePdfs({ sources: sourcesOf([first, 'a.pdf'], [second, 'b.pdf']) });

        expect(merged.sourcePageCounts).toEqual([1, 2]);
        expect(merged.fileCount).toBe(2);
    });

    it('merges a single file, which is what a page selection on one file is', async () => {
        const only = await makePdf({ pages: [{ width: 101 }, { width: 102 }] });

        const merged = await mergePdfs({ sources: sourcesOf([only, 'a.pdf']) });

        expect(await widthsOf(merged.blob)).toEqual([101, 102]);
    });
});

/* ------------------------------------------------------------------ *
 * Page selection
 * ------------------------------------------------------------------ */

describe('the caller chooses which pages, and in what order', () => {
    it('takes only the pages asked for', async () => {
        const first = await makePdf({ pages: [{ width: 101 }, { width: 102 }, { width: 103 }] });
        const second = await makePdf({ pages: [{ width: 201 }, { width: 202 }] });

        const merged = await mergePdfs({
            sources: sourcesOf([first, 'a.pdf'], [second, 'b.pdf']),
            plan: [{ fileIndex: 0, pageIndices: [0, 2] }, { fileIndex: 1, pageIndices: [1] }],
        });

        expect(await widthsOf(merged.blob)).toEqual([101, 103, 202]);
    });

    it('honours a reversed range — "file 2, pages 3 to 5 reversed"', async () => {
        const first = await makePdf({ pages: [{ width: 101 }] });
        const second = await makePdf({
            pages: [201, 202, 203, 204, 205].map((width) => ({ width })),
        });

        const merged = await mergePdfs({
            sources: sourcesOf([first, 'a.pdf'], [second, 'b.pdf']),
            plan: [{ fileIndex: 1, pageIndices: [4, 3, 2] }],
        });

        expect(await widthsOf(merged.blob)).toEqual([205, 204, 203]);
    });

    it('lets a file be read twice, and still opens it once', async () => {
        const first = await makePdf({ pages: [{ width: 101 }, { width: 102 }] });
        const second = await makePdf({ pages: [{ width: 201 }] });

        const merged = await mergePdfs({
            sources: sourcesOf([first, 'a.pdf'], [second, 'b.pdf']),
            plan: [
                { fileIndex: 0, pageIndices: [0] },
                { fileIndex: 1 },
                { fileIndex: 0, pageIndices: [1, 0] },
            ],
        });

        // fileCount is the number of files OPENED, and file 0 is named by two
        // steps. Two, not three, is the whole memory claim: one source parsed
        // at a time and never the same one twice.
        expect(merged.fileCount).toBe(2);
        expect(await widthsOf(merged.blob)).toEqual([101, 201, 102, 101]);
    });

    it('treats an omitted page list as every page of that file', async () => {
        const first = await makePdf({ pages: [{ width: 101 }, { width: 102 }] });

        const merged = await mergePdfs({
            sources: sourcesOf([first, 'a.pdf']),
            plan: [{ fileIndex: 0 }],
        });

        expect(await widthsOf(merged.blob)).toEqual([101, 102]);
    });

    it('refuses a page the file does not have, and says how many it has', async () => {
        const first = await makePdf({ pages: [{ width: 101 }, { width: 102 }] });

        await expect(mergePdfs({
            sources: sourcesOf([first, 'statement.pdf']),
            plan: [{ fileIndex: 0, pageIndices: [0, 7] }],
        })).rejects.toThrow('statement.pdf has 2 pages, so page 8 cannot be included.');
    });

    it('counts pages the way a person does when there is only one', async () => {
        const first = await makePdf({ pages: [{ width: 101 }] });

        await expect(mergePdfs({
            sources: sourcesOf([first, 'cover.pdf']),
            plan: [{ fileIndex: 0, pageIndices: [3] }],
        })).rejects.toThrow('cover.pdf has 1 page, so page 4 cannot be included.');
    });

    it('refuses a plan that names a file nobody chose', () => {
        expect(parseMergePlan([{ fileIndex: 4 }], 2)).toEqual({
            ok: false,
            error: 'The page selection names file 5, which was not chosen.',
        });
    });

    it('refuses a plan step that does not say which file it means', () => {
        expect(parseMergePlan([{ pageIndices: [0] }], 2)).toEqual({
            ok: false,
            error: 'The page selection must say which file each set of pages comes from.',
        });
    });

    it('refuses page numbers that are not whole numbers', () => {
        expect(parseMergePlan([{ fileIndex: 0, pageIndices: [1.5] }], 1).ok).toBe(false);
        expect(parseMergePlan([{ fileIndex: 0, pageIndices: [-1] }], 1).ok).toBe(false);
    });

    it('defaults to every page of every file when no plan is given', () => {
        expect(parseMergePlan(null, 3)).toEqual({
            ok: true,
            value: [
                { fileIndex: 0, pageIndices: null },
                { fileIndex: 1, pageIndices: null },
                { fileIndex: 2, pageIndices: null },
            ],
        });
    });

    it('refuses a selection that would produce no pages at all', async () => {
        const first = await makePdf({ pages: [{ width: 101 }] });

        await expect(mergePdfs({
            sources: sourcesOf([first, 'a.pdf']),
            plan: [{ fileIndex: 0, pageIndices: [] }],
        })).rejects.toThrow('No pages were selected, so there is nothing to combine.');
    });
});

/* ------------------------------------------------------------------ *
 * The page itself
 * ------------------------------------------------------------------ */

describe('a page keeps its shape', () => {
    it('carries each page size across untouched, mixed sizes and all', async () => {
        const first = await makePdf({ pages: [{ width: 612, height: 792 }] });
        const second = await makePdf({ pages: [{ width: 842, height: 595 }] });

        const merged = await mergePdfs({ sources: sourcesOf([first, 'letter.pdf'], [second, 'wide.pdf']) });

        expect(await pageShapesOf(merged.blob)).toEqual([
            { width: 612, height: 792, rotation: 0 },
            { width: 842, height: 595, rotation: 0 },
        ]);
    });

    it('carries the page rotation a scanner recorded', async () => {
        const scanned = await makePdf({
            pages: [
                { width: 400, height: 600, rotation: 90 },
                { width: 400, height: 600, rotation: 270 },
                { width: 400, height: 600 },
            ],
        });

        const merged = await mergePdfs({ sources: sourcesOf([scanned, 'scan.pdf']) });

        expect((await pageShapesOf(merged.blob)).map((page) => page.rotation)).toEqual([90, 270, 0]);
    });

    it('keeps size and rotation together through a reorder', async () => {
        const source = await makePdf({
            pages: [
                { width: 300, height: 400 },
                { width: 500, height: 700, rotation: 180 },
            ],
        });

        const merged = await mergePdfs({
            sources: sourcesOf([source, 'a.pdf']),
            plan: [{ fileIndex: 0, pageIndices: [1, 0] }],
        });

        expect(await pageShapesOf(merged.blob)).toEqual([
            { width: 500, height: 700, rotation: 180 },
            { width: 300, height: 400, rotation: 0 },
        ]);
    });
});

/* ------------------------------------------------------------------ *
 * The refusals
 * ------------------------------------------------------------------ */

describe('a file that is not a PDF is refused by name', () => {
    it('refuses a PNG with a sentence that says what is wrong', async () => {
        await expect(mergePdfs({ sources: sourcesOf([PNG_BYTES, 'holiday.png']) }))
            .rejects.toThrow('holiday.png is not a PDF, so its pages cannot be read.');
    });

    it('refuses it even when it is called .pdf', async () => {
        await expect(mergePdfs({ sources: sourcesOf([PNG_BYTES, 'invoice.pdf']) }))
            .rejects.toThrow('invoice.pdf is not a PDF, so its pages cannot be read.');
    });

    it('names the offending file, not the first one', async () => {
        const good = await makePdf({ pages: [{ width: 101 }] });

        await expect(mergePdfs({ sources: sourcesOf([good, 'good.pdf'], [PNG_BYTES, 'bad.pdf']) }))
            .rejects.toThrow('bad.pdf is not a PDF, so its pages cannot be read.');
    });

    it('still says something usable when there is no filename', async () => {
        await expect(mergePdfs({ sources: [{ source: PNG_BYTES }] }))
            .rejects.toThrow('That file is not a PDF, so its pages cannot be read.');
    });
});

describe('a damaged PDF fails cleanly', () => {
    it('refuses a file with a PDF header and nothing usable behind it', async () => {
        await expect(mergePdfs({ sources: sourcesOf([corruptPdf(), 'broken.pdf']) }))
            .rejects.toThrow('broken.pdf could not be read. The file looks damaged or incomplete.');
    });

    it('refuses a download that stopped part way through', async () => {
        // Three quarters of a real file. Where the cut lands matters: pdf-lib
        // recovers some truncations and returns every page, and when it does
        // the honest answer is to merge them rather than to refuse a file that
        // is demonstrably readable. This cut is one it cannot recover.
        const whole = await makePdf({ pages: [{ width: 101 }, { width: 102 }] });
        const truncated = whole.subarray(0, Math.floor(whole.length * 0.75));

        await expect(mergePdfs({ sources: sourcesOf([truncated, 'partial.pdf']) }))
            .rejects.toThrow('partial.pdf could not be read. The file looks damaged or incomplete.');
    });

    it('says the same thing about a file that loads and then falls apart', async () => {
        // The nastiest of the three: a valid header and an xref the parser
        // accepts, whose page tree is missing. It LOADS, and throws on the
        // first question. Nothing about that is visible until the page tree is
        // read, which is why openSource reads it inside its own guard.
        const error = await mergePdfs({ sources: sourcesOf([corruptPdf(), 'broken.pdf']) })
            .catch((thrown) => thrown);

        expect(error.code).toBe('damaged-pdf');
    });

    it('never lets a parser message reach a person', async () => {
        // The library throws a bare TypeError on this one — "Cannot read
        // properties of undefined (reading 'Pages')" — which is a stack trace
        // wearing a sentence's clothes.
        const error = await mergePdfs({ sources: sourcesOf([corruptPdf(), 'broken.pdf']) }).catch((thrown) => thrown);

        expect(error.message).not.toMatch(/undefined|Pages|TypeError/);
        expect(error.code).toBe('damaged-pdf');
        expect(error.suggestion).toBeTruthy();
    });

    it('refuses a PDF with no pages in it', async () => {
        await expect(mergePdfs({ sources: sourcesOf([zeroPagePdf(), 'empty.pdf']) }))
            .rejects.toThrow('empty.pdf has no pages in it.');
    });
});

describe('a password-protected PDF is named as such', () => {
    it('says it is password-protected and what to do about it', async () => {
        const error = await mergePdfs({ sources: sourcesOf([await encryptedPdf(), 'statement.pdf']) })
            .catch((thrown) => thrown);

        expect(error.message).toBe('statement.pdf is password-protected, so its pages cannot be read.');
        expect(error.suggestion).toBe('Remove the password in the app that made it, then add the file again.');
        expect(error.code).toBe('encrypted-pdf');
    });

    it('does not confuse it with a damaged file', async () => {
        const error = await mergePdfs({ sources: sourcesOf([await encryptedPdf(), 'statement.pdf']) })
            .catch((thrown) => thrown);

        expect(error.code).not.toBe('damaged-pdf');
    });

    it('never repeats the library’s own advice, which does not work', async () => {
        const error = await mergePdfs({ sources: sourcesOf([await encryptedPdf(), 'statement.pdf']) })
            .catch((thrown) => thrown);

        // pdf-lib's message tells the reader to pass ignoreEncryption. Measured
        // against @cantoo/pdf-lib 2.8.2, that flag loads the document and copies
        // its pages, and the copied content streams are still encrypted — the
        // merge "succeeds" and the pages are blank. The proof is below.
        expect(error.message).not.toMatch(/ignoreEncryption/);
    });

    it('is right to refuse: ignoreEncryption produces pages with nothing on them', async () => {
        const { StandardFonts } = await import('@cantoo/pdf-lib');

        const source = await PDFDocument.create();
        const page = source.addPage([300, 400]);
        page.drawText('HELLOWORLD', {
            x: 10,
            y: 100,
            size: 24,
            font: await source.embedFont(StandardFonts.Helvetica),
        });

        const plainBytes = Buffer.from(await source.save());
        source.encrypt({ userPassword: 'letmein', ownerPassword: 'owner' });
        const lockedBytes = Buffer.from(await source.save());

        // The writer stores the string as hex inside the content stream, so this
        // is what "the text is on the page" looks like in the bytes.
        const TEXT_IN_STREAM = Buffer.from('HELLOWORLD').toString('hex').toUpperCase();

        const copyThrough = async (bytes, loadOptions) => {
            const opened = await PDFDocument.load(bytes, loadOptions);
            const out = await PDFDocument.create();
            const [copied] = await out.copyPages(opened, [0]);
            out.addPage(copied);
            return inflatedStreams(Buffer.from(await out.save()));
        };

        expect(await copyThrough(plainBytes, {})).toContain(TEXT_IN_STREAM);
        expect(await copyThrough(lockedBytes, { ignoreEncryption: true })).not.toContain(TEXT_IN_STREAM);
    });
});

/* ------------------------------------------------------------------ *
 * Metadata
 * ------------------------------------------------------------------ */

describe('nobody’s name comes through', () => {
    const SOURCE_METADATA = {
        title: 'March Bank Statement',
        author: 'Jane Q Doe',
        subject: 'Salary payments',
        producer: 'AcmeScan Pro 3000',
        creator: 'Acme Document Suite',
    };

    it('does not inherit the source’s title, author, subject or producer', async () => {
        const source = await makePdf({ pages: [{ width: 101 }], metadata: SOURCE_METADATA });

        const merged = await mergePdfs({ sources: sourcesOf([source, 'statement.pdf']) });

        expect(await metadataOf(merged.blob)).toEqual({
            title: '',
            author: '',
            subject: '',
            producer: MERGE_PRODUCER,
            creator: MERGE_PRODUCER,
        });
    });

    it('leaves none of those strings anywhere in the file', async () => {
        const source = await makePdf({ pages: [{ width: 101 }], metadata: SOURCE_METADATA });

        const merged = await mergePdfs({ sources: sourcesOf([source, 'statement.pdf']) });
        const bytes = Buffer.from(await merged.blob.arrayBuffer()).toString('latin1');

        // The getters above read one dictionary. This reads the whole file, so
        // a copy of the Info block left somewhere else would still be caught.
        for (const value of Object.values(SOURCE_METADATA)) {
            expect(bytes).not.toContain(value);
        }
    });

    it('does not let the second file’s metadata through either', async () => {
        const first = await makePdf({ pages: [{ width: 101 }] });
        const second = await makePdf({ pages: [{ width: 201 }], metadata: SOURCE_METADATA });

        const merged = await mergePdfs({ sources: sourcesOf([first, 'a.pdf'], [second, 'b.pdf']) });

        expect((await metadataOf(merged.blob)).author).toBe('');
    });
});

/* ------------------------------------------------------------------ *
 * The memory gate
 * ------------------------------------------------------------------ */

describe('the cost of a merge is bytes, and only bytes', () => {
    it('charges the sum of the inputs for the document and the largest one for the source', () => {
        const files = [{ fileBytes: 4 * MEGABYTE }, { fileBytes: 1 * MEGABYTE }];

        expect(estimatePdfMergePeakBytes({ files })).toBe(
            (5 * MEGABYTE * PDF_DOCUMENT_COPIES) + (4 * MEGABYTE * PDF_MERGE_SOURCE_COPIES),
        );
    });

    it('scales with the input bytes', () => {
        const small = estimatePdfMergePeakBytes({ files: [{ fileBytes: 1 * MEGABYTE }] });
        const large = estimatePdfMergePeakBytes({ files: [{ fileBytes: 10 * MEGABYTE }] });

        expect(large).toBe(small * 10);
    });

    it('charges one source at a time, not all of them', () => {
        const sequential = estimatePdfMergePeakBytes({
            files: [{ fileBytes: MEGABYTE }, { fileBytes: MEGABYTE }, { fileBytes: MEGABYTE }],
        });

        // Three files of a megabyte: three megabytes of document, and ONE
        // megabyte of source. Charging all three sources would be the bug this
        // asserts against.
        expect(sequential).toBe((3 * MEGABYTE * PDF_DOCUMENT_COPIES) + (MEGABYTE * PDF_MERGE_SOURCE_COPIES));
    });

    it('charges no pixel surface — a merge never decodes anything', () => {
        const fileBytes = 2 * MEGABYTE;

        const merge = estimatePdfMergePeakBytes({ files: [{ fileBytes }] });
        // The same two megabytes going through an image job: one 12 MP surface
        // is 45.8 MB before a single copy, and the gate charges several.
        const image = estimatePeakBytes({
            sourceWidth: 4032,
            sourceHeight: 3024,
            fileBytes,
            operation: 'convert',
        });

        expect(merge).toBeLessThan(image / 5);
        expect(merge).toBe(fileBytes * (PDF_DOCUMENT_COPIES + PDF_MERGE_SOURCE_COPIES));
    });

    it('charges no WebAssembly baseline, because no codec is loaded', () => {
        expect(estimatePdfMergePeakBytes({ files: [{ fileBytes: 0 }] })).toBe(0);
        expect(estimatePdfMergePeakBytes({ files: [] })).toBe(0);
        expect(estimatePdfMergePeakBytes({ files: [{ fileBytes: MEGABYTE }] }))
            .toBeLessThan(WASM_BASELINE_BYTES);
    });

    it('does not refuse a device with WebAssembly switched off', () => {
        // @cantoo/pdf-lib is plain JavaScript. Every other gate in that file
        // refuses without WASM; this job genuinely does not need it.
        const device = { memoryGb: 4, ios: false, nativeDownscale: true, wasm: false };

        expect(assessPdfMergeJob({ files: [{ fileBytes: MEGABYTE }], device }).ok).toBe(true);
    });

    it('refuses more files than the site allows anywhere else', () => {
        const files = Array.from({ length: MAX_BULK_FILES + 1 }, () => ({ fileBytes: 1000 }));
        const gate = assessPdfMergeJob({ files });

        expect(gate.ok).toBe(false);
        expect(gate.code).toBe('too-many-files');
        expect(gate.reason).toContain(String(MAX_BULK_FILES));
    });

    it('refuses a total past the bulk ceiling', () => {
        const files = [{ fileBytes: MAX_BULK_TOTAL_BYTES + 1 }];
        const gate = assessPdfMergeJob({ files });

        expect(gate.ok).toBe(false);
        expect(gate.code).toBe('total-too-large');
    });

    it('refuses a job past the device budget, and says both numbers', () => {
        // A small phone: 1 GB reported, and the extra iOS haircut on top. Two
        // 20 MB files are well inside the bulk ceiling and still do not fit.
        const device = { memoryGb: 1, ios: true, nativeDownscale: true, wasm: true };
        const files = [{ fileBytes: 20 * MEGABYTE }, { fileBytes: 20 * MEGABYTE }];

        expect(estimatePdfMergePeakBytes({ files })).toBeGreaterThan(deviceBudgetBytes(device));

        const gate = assessPdfMergeJob({ files, device });

        expect(gate.ok).toBe(false);
        expect(gate.code).toBe('not-enough-memory');
        expect(gate.reason).toContain('MB');
        expect(gate.suggestion).toBe('Combine fewer at a time, or try it on a computer.');
    });

    it('refuses an empty job', () => {
        expect(assessPdfMergeJob({ files: [] })).toMatchObject({ ok: false, code: 'no-file' });
    });
});

/* ------------------------------------------------------------------ *
 * What the panel has to know before anybody presses anything
 * ------------------------------------------------------------------ */

/**
 * The page count and the lock are the two facts a person needs BEFORE the
 * button, and both need the file opened. So the panel opens every file as it
 * lands, and this is the function it uses — which means every refusal mergePdfs
 * can produce has to be producible here too, in the same words. A file rejected
 * at intake and the same file rejected at merge time saying different things
 * would be two bugs waiting to disagree.
 */
describe('a file reports what it holds as it is added', () => {
    it('counts the pages of a real PDF', async () => {
        const bytes = await makePdf({ pages: [{ width: 101 }, { width: 102 }, { width: 103 }] });

        await expect(readPdfPageCount({ source: fileOf(bytes), name: 'a.pdf' })).resolves.toBe(3);
    });

    it('names a password-protected file at intake rather than after the button', async () => {
        const locked = await encryptedPdf();

        const error = await readPdfPageCount({ source: fileOf(locked, 'statement.pdf'), name: 'statement.pdf' })
            .catch((thrown) => thrown);

        expect(error.code).toBe('encrypted-pdf');
        expect(error.message).toContain('statement.pdf');
        expect(error.message).toContain('password-protected');
        // The half that tells somebody what to do, which is the half a panel
        // showing only the message would throw away.
        expect(error.suggestion).toMatch(/remove the password/i);
    });

    it('refuses a file that is not a PDF by its bytes, whatever it is called', async () => {
        const error = await readPdfPageCount({ source: fileOf(PNG_BYTES, 'scan.pdf'), name: 'scan.pdf' })
            .catch((thrown) => thrown);

        expect(error.code).toBe('invalid-type');
        expect(error.message).toContain('scan.pdf');
    });

    it('refuses a damaged file and an empty one, each for what is actually wrong', async () => {
        const damaged = await readPdfPageCount({ source: fileOf(corruptPdf(), 'a.pdf'), name: 'a.pdf' })
            .catch((thrown) => thrown);
        const empty = await readPdfPageCount({ source: fileOf(zeroPagePdf(), 'b.pdf'), name: 'b.pdf' })
            .catch((thrown) => thrown);

        expect(damaged.code).toBe('damaged-pdf');
        expect(empty.code).toBe('empty-pdf');
        expect(empty.message).toContain('no pages');
    });

    it('gives the same answer the merge itself would, so the two cannot disagree', async () => {
        const bytes = await makePdf({ pages: [{ width: 101 }, { width: 102 }] });

        const counted = await readPdfPageCount({ source: fileOf(bytes), name: 'a.pdf' });
        const merged = await mergePdfs({ sources: sourcesOf([bytes, 'a.pdf']) });

        expect(counted).toBe(merged.sourcePageCounts[0]);
    });
});

/* ------------------------------------------------------------------ *
 * The page box
 * ------------------------------------------------------------------ */

/**
 * `1-3, 7` is what a person types; `[0, 1, 2, 6]` is what the plan takes. The
 * off-by-one between the two is the entire reason this is one function in lib
 * rather than four lines in a component — it is the sort of arithmetic that
 * gets written twice and gets it right once.
 */
describe('the pages a person types', () => {
    it('reads single numbers, ranges, and both together', () => {
        expect(parsePageRange('1-3, 7', 10)).toEqual({ ok: true, value: [0, 1, 2, 6] });
        expect(parsePageRange('4', 10)).toEqual({ ok: true, value: [3] });
        expect(parsePageRange('2-2', 10)).toEqual({ ok: true, value: [1] });
    });

    it('accepts spaces, commas or both as the separator', () => {
        const expected = { ok: true, value: [0, 4] };

        expect(parsePageRange('1 5', 10)).toEqual(expected);
        expect(parsePageRange('1,5', 10)).toEqual(expected);
        expect(parsePageRange('  1 ,  5  ', 10)).toEqual(expected);
    });

    it('takes an en dash, which is what a phone keyboard and a paste both produce', () => {
        expect(parsePageRange('1–3', 10)).toEqual({ ok: true, value: [0, 1, 2] });
    });

    it('reverses a section when the range descends, because that is what it says', () => {
        expect(parsePageRange('5-3', 10)).toEqual({ ok: true, value: [4, 3, 2] });
    });

    it('lets a page be named twice, so a cover can also close the document', () => {
        expect(parsePageRange('1, 3, 1', 10)).toEqual({ ok: true, value: [0, 2, 0] });
    });

    it('keeps the order typed rather than sorting it', () => {
        expect(parsePageRange('7, 1-2', 10).value).toEqual([6, 0, 1]);
    });

    it('refuses a page the file does not have, and says how many it has', () => {
        const result = parsePageRange('1-3', 2);

        expect(result.ok).toBe(false);
        expect(result.error).toContain('2 pages');
        expect(result.error).toContain('no page 3');
    });

    it('refuses page zero, because a reader counts from one', () => {
        expect(parsePageRange('0', 10)).toMatchObject({ ok: false });
        expect(parsePageRange('0', 10).error).toMatch(/numbered from 1/i);
    });

    it.each([
        ['nothing at all', ''],
        ['only spaces', '   '],
        ['words', 'all of them'],
        ['a half-written range', '3-'],
        ['a negative', '-4'],
        ['a decimal', '1.5'],
    ])('refuses %s with a sentence rather than a silent empty selection', (_label, input) => {
        const result = parsePageRange(input, 10);

        expect(result.ok).toBe(false);
        expect(result.error.length).toBeGreaterThan(10);
        expect(result.value).toBeUndefined();
    });

    it('refuses to answer at all until the file has reported a page count', () => {
        for (const count of [0, null, undefined, NaN, 'lots']) {
            expect(parsePageRange('1', count).ok).toBe(false);
        }
    });

    it('produces indices parseMergePlan accepts, which is the only reason it exists', () => {
        const parsed = parsePageRange('3, 1', 5);
        const plan = parseMergePlan([{ fileIndex: 0, pageIndices: parsed.value }], 1);

        expect(plan).toEqual({ ok: true, value: [{ fileIndex: 0, pageIndices: [2, 0] }] });
    });

    it('selects the pages it names, end to end through the engine', async () => {
        const bytes = await makePdf({
            pages: [{ width: 101 }, { width: 102 }, { width: 103 }, { width: 104 }],
        });
        const parsed = parsePageRange('4, 2-1', 4);

        const merged = await mergePdfs({
            sources: sourcesOf([bytes, 'a.pdf']),
            plan: [{ fileIndex: 0, pageIndices: parsed.value }],
        });

        expect(await widthsOf(merged.blob)).toEqual([104, 102, 101]);
    });
});

/* ------------------------------------------------------------------ *
 * Through the operation registry
 * ------------------------------------------------------------------ */

describe('the op the worker runs', () => {
    it('merges files handed to it as the picker hands them over', async () => {
        const first = await makePdf({ pages: [{ width: 101 }, { width: 102 }] });
        const second = await makePdf({ pages: [{ width: 201 }] });

        const result = await runOperation('merge', [fileOf(first, 'a.pdf'), fileOf(second, 'b.pdf')]);

        expect(result.pageCount).toBe(3);
        expect(await widthsOf(result.blob)).toEqual([101, 102, 201]);
    });

    it('names the download through the one filename builder', async () => {
        const first = await makePdf({ pages: [{ width: 101 }] });

        const result = await runOperation('merge', [fileOf(first, 'March Statement.pdf')]);

        expect(result.filename).toBe('resizo-merged-March-Statement.pdf');
        expect(result.format).toBe('pdf');
        expect(result.type).toBe('application/pdf');
    });

    it('reports the whole job’s bytes, not the first file’s', async () => {
        const first = await makePdf({ pages: [{ width: 101 }] });
        const second = await makePdf({ pages: [{ width: 201 }, { width: 202 }] });

        const result = await runOperation('merge', [fileOf(first, 'a.pdf'), fileOf(second, 'b.pdf')]);

        expect(result.originalBytes).toBe(first.length + second.length);
        expect(result.width).toBeNull();
        expect(result.height).toBeNull();
    });

    it('takes a page selection through the options', async () => {
        const first = await makePdf({ pages: [{ width: 101 }, { width: 102 }, { width: 103 }] });

        const result = await runOperation('merge', [fileOf(first, 'a.pdf')], {
            plan: [{ fileIndex: 0, pageIndices: [2, 0] }],
        });

        expect(await widthsOf(result.blob)).toEqual([103, 101]);
    });

    it('refuses a file whose bytes are not a PDF, before anything is parsed', async () => {
        const good = await makePdf({ pages: [{ width: 101 }] });

        await expect(runOperation('merge', [fileOf(good, 'a.pdf'), fileOf(PNG_BYTES, 'b.pdf')]))
            .rejects.toThrow(JobError);
    });

    it('carries the password refusal out as something the UI can branch on', async () => {
        const locked = await encryptedPdf();

        const error = await runOperation('merge', [fileOf(locked, 'statement.pdf')]).catch((thrown) => thrown);

        expect(error).toBeInstanceOf(JobError);
        expect(error.code).toBe('encrypted-pdf');
        expect(error.message).toContain('password-protected');
        expect(error.suggestion).toContain('Remove the password');
    });

    it('refuses an empty list of files', async () => {
        await expect(runOperation('merge', [])).rejects.toThrow('No PDFs were provided.');
    });

    it('reports progress and finishes at 100', async () => {
        const first = await makePdf({ pages: [{ width: 101 }] });
        const second = await makePdf({ pages: [{ width: 201 }] });

        const seen = [];
        await runOperation(
            'merge',
            [fileOf(first, 'a.pdf'), fileOf(second, 'b.pdf')],
            {},
            { onProgress: (progress) => seen.push(progress) },
        );

        expect(seen[seen.length - 1]).toBe(100);
        expect(seen.every((value, index) => index === 0 || value >= seen[index - 1])).toBe(true);
    });

    it('stops when the job is cancelled', async () => {
        const first = await makePdf({ pages: [{ width: 101 }] });
        const second = await makePdf({ pages: [{ width: 201 }] });

        let calls = 0;
        const checkCancelled = () => {
            calls += 1;
            if (calls > 2) throw new JobError('Cancelled.', { code: 'cancelled' });
        };

        const error = await runOperation('merge', [fileOf(first, 'a.pdf'), fileOf(second, 'b.pdf')], {}, {
            checkCancelled,
        }).catch((thrown) => thrown);

        expect(error.code).toBe('cancelled');
    });
});

/* ------------------------------------------------------------------ *
 * Reading a finished document's content streams
 * ------------------------------------------------------------------ */

/**
 * Every stream in a PDF, inflated where it can be.
 *
 * Used by exactly one test — the one that proves ignoreEncryption is not a fix —
 * because that is the only claim here which cannot be made from the page tree.
 * A page copied out of a locked document has the right size and the right
 * rotation and is still blank, so the assertion has to reach the drawing
 * commands themselves.
 */
function inflatedStreams(pdfBytes) {
    const parts = [];
    let at = 0;

    while (at < pdfBytes.length) {
        const start = pdfBytes.indexOf('stream', at);
        if (start < 0) break;

        let from = start + 'stream'.length;
        if (pdfBytes[from] === 0x0D) from += 1;
        if (pdfBytes[from] === 0x0A) from += 1;

        const end = pdfBytes.indexOf('endstream', from);
        if (end < 0) break;

        const raw = pdfBytes.subarray(from, end);
        try {
            parts.push(zlib.inflateSync(raw).toString('latin1'));
        } catch {
            parts.push(raw.toString('latin1'));
        }

        at = end + 'endstream'.length;
    }

    return parts.join('\n').toUpperCase();
}
