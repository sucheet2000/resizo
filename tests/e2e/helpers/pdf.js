/**
 * A downloaded PDF, opened and measured by something that is not the product.
 *
 * Every other download on this site is an image, and sharp reads those back as
 * the repository's independent libvips reference (../helpers/output.js). A PDF
 * is the one download libvips has nothing to say about: it is a container, its
 * page size is a number in a dictionary rather than a pixel count, and the
 * picture inside it is a stream the reader never has to decode.
 *
 * WHY THE PAGE SIZE IS THE THING WORTH READING. A print sheet's whole promise
 * is a physical measurement — this photo comes off the printer at two inches
 * across — and in a PDF that promise lives entirely in the page's MediaBox,
 * measured in points, 72 to the inch. A sheet whose page box is wrong prints at
 * the wrong size on every printer in the world while looking perfectly correct
 * on screen, and nothing about the bytes of the embedded JPEG would show it.
 * So this reads the box, and the flows compare it against points derived from
 * the paper size rather than against a number anybody typed.
 *
 * pdf-lib is the same library the engine writes with, which is worth saying out
 * loud: this is not an independent implementation the way sharp is for the
 * image paths. It is still a real second reading — the document is re-parsed
 * from the saved bytes, so a truncated file, a document with two pages in it or
 * a page box the writer set from the wrong axis all fail here. What it cannot
 * catch is a bug in pdf-lib itself, and no test in this repository can.
 *
 * TEST-ONLY. Nothing under app/, lib/ or components/ may import this file — the
 * product reaches pdf-lib through `import()` inside lib/image-client/pdf.js and
 * nowhere else (CLAUDE.md > Architecture boundaries, rule 4). Here the plain
 * require is correct: this is Node, there is no chunk to keep out of, and the
 * cost of loading it is paid by a test rather than by a visitor.
 */
const fs = require('node:fs');

const { PDFDocument } = require('@cantoo/pdf-lib');

/**
 * Reads a saved PDF and returns its pages' sizes.
 *
 * @param {string} file  path to the document the browser saved
 * @returns {Promise<{ pageCount: number, pages: Array<{ widthPt: number, heightPt: number }> }>}
 *   `pageCount` and one entry per page IN DOCUMENT ORDER, each carrying the
 *   page's width and height in PostScript points (72 to the inch). Both come
 *   from the page's own size rather than from any default, so a document whose
 *   pages differ in size reports them differently instead of averaging them
 *   into one claim.
 *
 * Throws if the file is not a PDF, is truncated, or is encrypted — a download
 * that cannot be reopened is a failure worth stating, not a zero to report.
 */
async function readPdf(file) {
    const bytes = fs.readFileSync(file);

    // `ignoreEncryption` is deliberately NOT set. Nothing in this engine writes
    // an encrypted document, so one appearing here is a finding rather than an
    // inconvenience to work around.
    const document = await PDFDocument.load(bytes);

    const pages = document.getPages().map((page) => {
        const { width, height } = page.getSize();
        return { widthPt: width, heightPt: height };
    });

    return { pageCount: pages.length, pages };
}

module.exports = { readPdf };
