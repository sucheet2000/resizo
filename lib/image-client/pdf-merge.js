/**
 * Several PDFs into one, on the device
 *
 * This is the tool every competitor has and every competitor uploads for.
 * iLovePDF, Smallpdf and PDF24 all say on their own pages that the file is sent
 * to their servers, and the files people actually merge are contracts, bank
 * statements, signed agreements and scans of an ID. We never receive them,
 * because there is nothing here to receive them with.
 *
 * WHY THIS IS A SEPARATE MODULE FROM lib/image-client/pdf.js
 *
 * pdf.js turns PIXELS INTO PAGES. Its whole substance is the two lanes a photo
 * can take into a document, the EXIF orientation problem, the JPEG segment
 * walk, the page geometry and the size search. This module turns PAGES INTO
 * PAGES and uses none of it: nothing is decoded, no geometry is computed, no
 * quality exists to search over. The only thing the two share is the writer, and
 * that is imported from pdf.js rather than from the package so the rule pdf.js
 * states about itself stays literally true — there is still exactly one
 * `import('@cantoo/pdf-lib')` in this repo.
 *
 * WHY MERGING IS CHEAP, AND WHAT IT STILL COSTS
 *
 * copyPages moves a page across as an OBJECT GRAPH. The content stream is
 * carried as the compressed bytes it already was, an embedded scan stays the
 * JPEG it always was, and nothing is ever handed to a decoder. So there is no
 * pixel surface anywhere in this job — a forty-page scanned statement costs
 * roughly what the file weighs, not what its pages would weigh as bitmaps.
 *
 * What it does cost is bytes, and all of them are live at once unless something
 * makes them not be. So the loop below opens ONE source at a time, copies the
 * pages it contributes, and drops it before opening the next. That is the same
 * shape as the one-image-alive-at-a-time rule in pdf.js, and it is what
 * estimatePdfMergePeakBytes in lib/image-client/capability.js is allowed to
 * assume.
 *
 * ENCRYPTION IS THE FAILURE THAT MATTERS, AND `ignoreEncryption` IS NOT THE FIX
 *
 * A password-protected bank statement is exactly the sort of file this tool will
 * be handed, and pdf-lib throws EncryptedPDFError on it. The library's own error
 * message suggests `ignoreEncryption: true`, and that suggestion is a trap.
 * Measured against @cantoo/pdf-lib 2.8.2, with a document whose page draws the
 * text HELLOWORLD:
 *
 *   load(bytes)                        throws EncryptedPDFError
 *   load(bytes, { ignoreEncryption })  succeeds, copyPages succeeds, and the
 *                                      copied page's content stream does NOT
 *                                      contain the text — the streams are still
 *                                      encrypted, so what lands in the merged
 *                                      file is garbage a reader shows as blank
 *   load(bytes, { password })          succeeds and the text survives
 *
 * So `ignoreEncryption` does not merge a locked PDF, it silently produces empty
 * pages and calls it a success. It is never passed here. The file is refused
 * with a sentence that says what is actually wrong and what to do about it.
 */
import { isPdfSignature } from '@/lib/image/magic-bytes';
import { loadPdfLib, readAllBytes } from '@/lib/image-client/pdf';

/**
 * What the merged document says it was made by.
 *
 * Set rather than left alone, and this is a privacy measure rather than a
 * credit. A PDF's Info dictionary carries Title, Author and Producer, and on a
 * real document those are a person's name, their employer's name and the name
 * of the scanner in their office. The image tools strip EXIF for the same
 * reason — a file built here must not name the person who built it — and this is
 * that promise, kept in the one place a PDF can break it.
 */
export const MERGE_PRODUCER = 'Resizo';

/** The download name's prefix, in the shape every other tool's output has. */
export const MERGE_FILENAME_PREFIX = 'resizo-merged';

/**
 * A refusal this module cannot phrase as a JobError.
 *
 * Same arrangement as pdf.js: JobError lives in operations.js, which imports
 * this file, so importing it back would close a cycle. The code and the
 * suggestion ride on a plain Error and runMergePdf rebuilds them.
 */
function fail(code, message, suggestion = null) {
    return Object.assign(new Error(message), { code, suggestion });
}

/**
 * How a file is named in a refusal.
 *
 * The name if there is one, because with several files chosen "that file" tells
 * a person nothing about which one to go and fix.
 */
function label(entry) {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    return name === '' ? 'That file' : name;
}

/* ------------------------------------------------------------ the refusals */

function notPdfError(entry) {
    return fail(
        'invalid-type',
        `${label(entry)} is not a PDF, so its pages cannot be read.`,
        'Choose PDF files only.',
    );
}

/**
 * The one refusal this tool exists to get right.
 *
 * It names the actual problem — a password — rather than repeating whatever the
 * library said, because pdf-lib's own sentence tells the reader to set
 * `ignoreEncryption`, which is advice for a programmer and, as measured at the
 * top of this file, produces blank pages.
 */
function encryptedError(entry) {
    return fail(
        'encrypted-pdf',
        `${label(entry)} is password-protected, so its pages cannot be read.`,
        'Remove the password in the app that made it, then add the file again.',
    );
}

function damagedError(entry) {
    return fail(
        'damaged-pdf',
        `${label(entry)} could not be read. The file looks damaged or incomplete.`,
        'Try opening it in another app and saving a copy, then add that copy.',
    );
}

function emptyError(entry) {
    return fail(
        'empty-pdf',
        `${label(entry)} has no pages in it.`,
        'Choose a PDF that has at least one page.',
    );
}

function pageRangeError(entry, pageCount, wantedIndex) {
    return fail(
        'invalid-page',
        `${label(entry)} has ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}, `
        + `so page ${wantedIndex + 1} cannot be included.`,
        'Choose page numbers that are in the file.',
    );
}

/* ------------------------------------------------------------ the selection */

/**
 * What to take from which file, in the order the pages are wanted.
 *
 * THE SHAPE, and it is one array with one entry per STEP rather than per file:
 *
 *   [{ fileIndex: 0 },
 *    { fileIndex: 1, pageIndices: [4, 3, 2] },
 *    { fileIndex: 0, pageIndices: [0] }]
 *
 *   fileIndex    which of the caller's `sources` this step reads, 0-based
 *   pageIndices  which of that file's pages, 0-BASED, in the order wanted.
 *                Omitted or null means every page of that file in its own
 *                order. Reversing, repeating and skipping are all just arrays.
 *
 * The finished document is the steps concatenated in order. Merging whole files
 * is therefore not a special case, it is the default plan: one step per file,
 * every page, in the order the files were given — which is what null means and
 * what buildDefaultPlan returns.
 *
 * A step is allowed to name a file an earlier step already used, so
 * "file 1, then file 2, then file 1's cover again" is expressible. The loop in
 * mergePdfs still opens that file exactly once.
 *
 * Nothing here can check a page number against a real page count — no file has
 * been read yet. This checks only the shape; mergePdfs checks the range against
 * the document, which is the only thing that can answer it.
 *
 * @param {Array|null} raw
 * @param {number} fileCount
 * @returns {{ ok: true, value: Array }|{ ok: false, error: string }}
 */
export function parseMergePlan(raw, fileCount) {
    if (raw === null || raw === undefined) {
        return { ok: true, value: buildDefaultPlan(fileCount) };
    }

    if (!Array.isArray(raw) || raw.length === 0) {
        return { ok: false, error: 'The page selection must be a list of files to take pages from.' };
    }

    const value = [];

    for (const step of raw) {
        const fileIndex = Number(step?.fileIndex);

        if (!Number.isInteger(fileIndex) || fileIndex < 0) {
            return { ok: false, error: 'The page selection must say which file each set of pages comes from.' };
        }

        if (fileIndex >= fileCount) {
            return { ok: false, error: `The page selection names file ${fileIndex + 1}, which was not chosen.` };
        }

        const wanted = step?.pageIndices;

        if (wanted === null || wanted === undefined) {
            value.push({ fileIndex, pageIndices: null });
            continue;
        }

        if (!Array.isArray(wanted)) {
            return { ok: false, error: 'Page numbers must be given as a list.' };
        }

        const pageIndices = [];
        for (const index of wanted) {
            const page = Number(index);
            if (!Number.isInteger(page) || page < 0) {
                return { ok: false, error: 'Page numbers must be whole numbers.' };
            }
            pageIndices.push(page);
        }

        value.push({ fileIndex, pageIndices });
    }

    return { ok: true, value };
}

/** Every file, every page, in the order they were given. */
export function buildDefaultPlan(fileCount) {
    const count = Number.isInteger(fileCount) && fileCount > 0 ? fileCount : 0;
    return Array.from({ length: count }, (unused, fileIndex) => ({ fileIndex, pageIndices: null }));
}

/**
 * What a person types into a page box — `1-3, 7` — as the 0-based indices
 * parseMergePlan takes.
 *
 * A SEPARATE FUNCTION FROM parseMergePlan, and separate on purpose. That one
 * validates a machine-shaped selection arriving at the engine; this one reads a
 * human-shaped one arriving from a text input, where the numbers are 1-based
 * because that is what a PDF reader shows in its page box, and where the
 * refusals have to be sentences rather than field names. It lives here rather
 * than in the component because it is pure, and because the -1 is the sort of
 * thing that gets written twice and gets it right once.
 *
 * A DESCENDING RANGE IS NOT AN ERROR. `5-3` means pages 5, 4, 3, in that order,
 * because that is the plain reading of it and because reversing a section is a
 * thing people genuinely want from a merge — a scanner that fed a stack the
 * wrong way up produces exactly that job. Repeats are allowed for the same
 * reason: `1, 5, 1` puts the cover back at the end and the plan can express it.
 *
 * @param {string} raw        `1-3, 7` — commas, spaces or both between entries
 * @param {number} pageCount  how many pages the file actually has
 * @returns {{ ok: true, value: number[] }|{ ok: false, error: string }}
 */
export function parsePageRange(raw, pageCount) {
    const total = Number(pageCount);
    if (!Number.isInteger(total) || total <= 0) {
        return { ok: false, error: 'This file’s pages have not been read yet.' };
    }

    const text = typeof raw === 'string' ? raw.trim() : '';
    if (text === '') {
        return { ok: false, error: `Type the pages you want, such as 1-${Math.min(3, total)}.` };
    }

    // An en dash because a phone keyboard and a copy-paste from a document both
    // produce one, and refusing "1–3" for a character nobody typed on purpose
    // is a refusal about punctuation rather than about pages.
    const parts = text.replace(/–|—/g, '-').split(/[,\s]+/).filter(Boolean);
    const value = [];

    for (const part of parts) {
        const range = part.match(/^(\d+)-(\d+)$/);
        const single = part.match(/^(\d+)$/);

        if (!range && !single) {
            return { ok: false, error: `“${part}” is not a page number or a range of them.` };
        }

        const from = Number(range ? range[1] : single[1]);
        const to = Number(range ? range[2] : single[1]);

        for (const number of [from, to]) {
            if (number < 1) {
                return { ok: false, error: 'Pages are numbered from 1.' };
            }
            if (number > total) {
                return {
                    ok: false,
                    error: `This file has ${total} ${total === 1 ? 'page' : 'pages'}, so there is no page ${number}.`,
                };
            }
        }

        const step = to >= from ? 1 : -1;
        for (let number = from; step > 0 ? number <= to : number >= to; number += step) {
            value.push(number - 1);
        }
    }

    if (value.length === 0) {
        return { ok: false, error: `Type the pages you want, such as 1-${Math.min(3, total)}.` };
    }

    return { ok: true, value };
}

/* ------------------------------------------------------------------ merge */

/**
 * Opens one source and reads its page tree, or says exactly why it will not.
 *
 * THE PAGE TREE IS READ IN HERE, not by the caller, and that is the whole
 * reason this returns three things instead of a document. A file with a valid
 * %PDF- header and nothing behind it LOADS WITHOUT COMPLAINT and then throws a
 * bare `Cannot read properties of undefined (reading 'Pages')` on the first
 * question asked of it — measured, not guessed. Guarding only the load would
 * have let that straight through to a person as their error message.
 *
 * `updateMetadata: false` because the default rewrites the loaded document's
 * Producer and ModDate on the way in. Nothing is read from a source's Info
 * dictionary and nothing is written back to the file, so that work is pointless
 * here — and leaving it on would mean the one code path that touches a source's
 * metadata is one nobody asked for.
 */
async function openSource({ PDFDocument, EncryptedPDFError }, bytes, entry) {
    try {
        const document = await PDFDocument.load(bytes, { updateMetadata: false });
        return { document, pageCount: document.getPageCount(), allPageIndices: document.getPageIndices() };
    } catch (error) {
        if (EncryptedPDFError && error instanceof EncryptedPDFError) {
            return openWithEmptyUserPassword(PDFDocument, bytes, entry);
        }
        // Everything else a parser can throw on a truncated, corrupt or
        // pretend-PDF file. None of them is a sentence anyone should be shown.
        throw damagedError(entry);
    }
}

/**
 * The permissions-restricted file, which is not the locked file.
 *
 * pdf-lib throws EncryptedPDFError whenever `trailerInfo.Encrypt` exists at
 * all, and that covers two very different documents:
 *
 *   a real USER password   nobody can open it without the password, and
 *                          refusing it is correct
 *   an OWNER password only opens with NO PROMPT in Preview, Acrobat and
 *                          Chrome — the flags restrict printing and copying,
 *                          not reading
 *
 * The second was being refused with "…is password-protected" and the advice
 * "Remove the password in the app that made it" — a password that does not
 * exist, so the advice could not be followed. MergePdfTool removes the row on
 * that error, so those files could not be used at all. Published reports,
 * government and tax forms, e-tickets and invoices are routinely saved this way.
 *
 * `password: ''` succeeds only when the user password is genuinely empty, so a
 * truly locked file still ends up refused exactly as before.
 *
 * ANY throw from the retry means refused, and that breadth is deliberate rather
 * than lazy: measured against @cantoo/pdf-lib, loading a file that has a real
 * user password with `{ password: '' }` throws a PLAIN Error reading
 * "NEEDS PASSWORD" — not an EncryptedPDFError. Reusing the instanceof check
 * here would send genuinely locked files down the damaged-file path and tell
 * people their statement was corrupt.
 *
 * Worth naming as a product decision: merging such a file overrides the
 * author's permission flags. The alternative is to keep refusing it, but then
 * the sentence has to change, because "remove the password" is not actionable.
 */
async function openWithEmptyUserPassword(PDFDocument, bytes, entry) {
    try {
        const document = await PDFDocument.load(bytes, { password: '', updateMetadata: false });
        return { document, pageCount: document.getPageCount(), allPageIndices: document.getPageIndices() };
    } catch {
        throw encryptedError(entry);
    }
}

/**
 * The merged document's metadata, set rather than inherited.
 *
 * copyPages does not carry a source's Info dictionary across — that was measured,
 * not assumed — so this is belt and braces rather than a repair. It is here
 * anyway because the alternative is a guarantee that depends on a library's
 * internals staying as they are, and because a fresh PDFDocument names the
 * library as its Producer, which is a detail about our build rather than about
 * the person's document.
 */
function setOutputMetadata(pdf) {
    pdf.setTitle('');
    pdf.setAuthor('');
    pdf.setSubject('');
    pdf.setKeywords([]);
    pdf.setProducer(MERGE_PRODUCER);
    pdf.setCreator(MERGE_PRODUCER);
}

/**
 * How many pages one PDF has, or exactly why it cannot be read.
 *
 * WHY THIS RUNS AT INTAKE AND NOT AT MERGE TIME. Two of the things a person
 * needs are only knowable by opening the file: how many pages it has, which is
 * what a page box has to be validated against, and whether it is locked. A
 * password-protected bank statement is the single most likely bad file this
 * tool will be handed, and finding out after the button is pressed — with four
 * other documents already chosen and reordered — is finding out at the worst
 * possible moment. So the panel asks the question as the file lands.
 *
 * It refuses in the same words mergePdfs refuses in, from the same helpers,
 * because a file rejected here and the same file rejected there must not be two
 * different sentences.
 *
 * Nothing is retained: the bytes and the parsed document are unreachable the
 * moment this returns, which is what lets a caller do this once per file
 * without the whole batch being resident. The merge opens them again — it has
 * to, since it is also an entry point in its own right — and that second read
 * is deliberately not optimised away by holding twenty parsed documents alive
 * on the chance that somebody presses the button.
 *
 * @param {{ source: Blob|Uint8Array|ArrayBuffer, name?: string }} entry
 * @returns {Promise<number>} the page count
 */
export async function readPdfPageCount(entry) {
    const bytes = await readAllBytes(entry?.source);

    if (!isPdfSignature(bytes)) throw notPdfError(entry);

    const lib = await loadPdfLib();
    const { pageCount } = await openSource(lib, bytes, entry);

    if (pageCount === 0) throw emptyError(entry);

    return pageCount;
}

/**
 * Combines PDFs into one document.
 *
 * Page size and rotation come across untouched, because they are properties of
 * the page object copyPages carries — a landscape sheet stays landscape and a
 * page a scanner turned 90 degrees stays turned. Nothing here computes geometry
 * and nothing here should ever start to.
 *
 * @param {object} input
 * @param {Array<{ source: Blob|Uint8Array|ArrayBuffer, name?: string }>} input.sources
 * @param {Array|null} [input.plan]  see parseMergePlan; null means every page of
 *   every file, in the order the files were given
 * @param {function} [input.guard]   throws to abort a cancelled job
 * @param {(done: number, total: number) => void} [input.onFile]
 * @returns {Promise<{ blob: Blob, bytes: number, pageCount: number, fileCount: number,
 *                     sourcePageCounts: number[] }>}
 */
export async function mergePdfs({ sources, plan = null, guard = null, onFile = null } = {}) {
    const list = Array.isArray(sources) ? sources : [];

    if (list.length === 0) {
        throw fail('no-file', 'No PDFs were provided.', 'Choose the PDFs you want to combine.');
    }

    const parsed = parseMergePlan(plan, list.length);
    if (!parsed.ok) throw fail('invalid-selection', parsed.error, 'Check the pages you asked for.');

    const steps = parsed.value;

    const lib = await loadPdfLib();
    const { PDFDocument } = lib;
    const merged = await PDFDocument.create();

    // Which steps read which file, so a file named by two steps is still opened
    // once. Ascending file order rather than step order for no reason beyond
    // being the order a person would expect a refusal to arrive in.
    const stepsByFile = new Map();
    for (const step of steps) {
        if (!stepsByFile.has(step.fileIndex)) stepsByFile.set(step.fileIndex, []);
        stepsByFile.get(step.fileIndex).push(step);
    }

    const fileIndices = [...stepsByFile.keys()].sort((a, b) => a - b);
    const sourcePageCounts = new Array(list.length).fill(0);

    let opened = 0;

    for (const fileIndex of fileIndices) {
        guard?.();

        const entry = list[fileIndex];

        // Read, sniffed and parsed inside one iteration, and unreachable after
        // it. This is the whole memory argument: at no point are two sources
        // resident, which is what estimatePdfMergePeakBytes charges for.
        const bytes = await readAllBytes(entry?.source);

        // By signature, never by extension or declared type. A .pdf that is
        // really an SVG or a zip must not reach the parser, which is the same
        // rule lib/image/magic-bytes.js enforces for every image on this site.
        if (!isPdfSignature(bytes)) throw notPdfError(entry);

        const { document, pageCount, allPageIndices } = await openSource(lib, bytes, entry);

        // A PDF with an empty page tree parses perfectly well and yields
        // nothing. Silently contributing zero pages would leave a person
        // wondering where their file went.
        if (pageCount === 0) throw emptyError(entry);

        sourcePageCounts[fileIndex] = pageCount;

        const fileSteps = stepsByFile.get(fileIndex);
        const wanted = [];

        for (const step of fileSteps) {
            const indices = step.pageIndices ?? allPageIndices;

            for (const index of indices) {
                if (index >= pageCount) throw pageRangeError(entry, pageCount, index);
            }

            step.resolved = indices;
            wanted.push(...indices);
        }

        // One call, so a file contributing pages to several steps is walked
        // once. The returned array lines up with `wanted`, which is how each
        // step gets its own pages back in its own order.
        //
        // Guarded the same way the load is: a page tree that counts pages it
        // cannot actually resolve fails here rather than at the load, and the
        // person asked for a merge either way.
        let copied;
        try {
            copied = await merged.copyPages(document, wanted);
        } catch {
            throw damagedError(entry);
        }

        let at = 0;
        for (const step of fileSteps) {
            step.pages = step.resolved.map(() => copied[at++]);
        }

        opened += 1;
        onFile?.(opened, fileIndices.length);
    }

    guard?.();

    // Added in PLAN order, which is the order the person asked for and has
    // nothing to do with the order the files were opened in.
    for (const step of steps) {
        for (const page of step.pages) merged.addPage(page);
    }

    if (merged.getPageCount() === 0) {
        throw fail(
            'no-pages',
            'No pages were selected, so there is nothing to combine.',
            'Choose at least one page.',
        );
    }

    setOutputMetadata(merged);

    guard?.();

    const saved = await merged.save();
    const blob = new Blob([saved], { type: 'application/pdf' });

    return {
        blob,
        bytes: blob.size,
        pageCount: merged.getPageCount(),
        fileCount: fileIndices.length,
        sourcePageCounts,
    };
}

export default mergePdfs;
