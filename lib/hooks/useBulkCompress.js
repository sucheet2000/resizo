'use client';

/**
 * Bulk compression, orchestrated in the browser.
 *
 * The state, the retry, the settings record and the two downloads are
 * lib/hooks/useBulkBatch.js, shared with the bulk converter. What is here is the
 * three things that make a batch a COMPRESS batch: the processor, the archive's
 * name, and the summary the compressor's panel reads.
 *
 * The sequencer and the archive builder are handed in from
 * lib/upload/compress-batch.js rather than reached for directly, so this tool's
 * run still goes through its own module — the settings arrive there as the pair
 * of named options that module has always taken.
 */
import { useMemo } from 'react';

import { useBulkBatch } from '@/lib/hooks/useBulkBatch';
import { buildZip, createCompressProcessor, runCompressBatch, summarize, ZIP_FILENAME } from '@/lib/upload/compress-batch';

/**
 * The platform hands a batch its settings as one opaque object; runCompressBatch
 * takes the limit and the mode as named options, because that is what it has
 * always taken and what its own suite asserts. This is the one line between them.
 */
function runWithNamedSettings({ settings, ...rest }) {
    return runCompressBatch({ ...rest, ...settings });
}

/**
 * @param {object}   [options]
 * @param {function} [options.processFile]  the per-file processor; injectable
 *   for tests, and the real one by default
 */
export function useBulkCompress({ processFile } = {}) {
    const defaultProcessor = useMemo(() => createCompressProcessor(), []);

    return useBulkBatch({
        processFile: processFile ?? defaultProcessor,
        zipFilename: ZIP_FILENAME,
        summarise: summarize,
        runBatch: runWithNamedSettings,
        buildArchive: buildZip,
    });
}

export default useBulkCompress;
