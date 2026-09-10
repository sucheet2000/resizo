/**
 * A downloaded ZIP, opened and read back entry by entry.
 *
 * The bulk tools hand back an archive, and an archive is the one download on
 * this site whose contents nothing on the page describes: the result list says
 * three files succeeded, the button says "Download all as ZIP (3)", and both of
 * those are the panel talking about itself. What is actually inside the file
 * the browser saved is a separate question, and it is the one a visitor lives
 * with — a missing entry, a duplicated name, a failed file smuggled in, or an
 * entry that is over the ceiling its row claimed to meet.
 *
 * So this reads the archive the same way an unzip tool would, with jszip, which
 * is already the archiver the product itself uses. Entries come back IN ARCHIVE
 * ORDER rather than sorted, because the order is part of the contract: a batch
 * comes back in the order it went in, and an assertion against a sorted list
 * could not tell the difference.
 *
 * Directory entries are dropped. Nothing in this product writes one today, and
 * a folder the visitor picked arrives as a path inside an entry's name rather
 * than as an entry of its own — so a directory record appearing here would be
 * a change worth failing on, and `readZip` returning it as a zero-byte "file"
 * would hide it inside a count instead.
 */
const fs = require('node:fs');

const JSZip = require('jszip');

/**
 * Reads a saved ZIP and returns its files.
 *
 * @param {string} file  path to the archive the browser saved
 * @returns {Promise<Array<{ name: string, bytes: number, buffer: Buffer }>>}
 *   one entry per file, in the order the archive lists them. `bytes` is the
 *   uncompressed length, which is what a size assertion is about — the entry's
 *   compressed length inside the container is not the file the visitor gets.
 */
async function readZip(file) {
    const archive = await JSZip.loadAsync(fs.readFileSync(file));

    const records = [];
    archive.forEach((_relativePath, entry) => {
        if (!entry.dir) records.push(entry);
    });

    const entries = [];
    for (const entry of records) {
        // Sequential on purpose: Promise.all would resolve in whatever order
        // the inflater finished, and the order is the thing being reported.
        const buffer = await entry.async('nodebuffer');
        entries.push({ name: entry.name, bytes: buffer.length, buffer });
    }

    return entries;
}

module.exports = { readZip };
