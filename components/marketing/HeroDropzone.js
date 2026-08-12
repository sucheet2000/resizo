'use client';

/**
 * HeroDropzone
 *
 * The homepage hero IS a working drop target, painted with the page and
 * reachable without scrolling — DESIGN.md is explicit that a visitor who has
 * already decided to convert should not have to hunt for the tool, and a CTA
 * button that scrolls to one is on the reject list.
 *
 * The workspace itself lives at /resize, which is the URL that should own the
 * visit, so this island takes the drop and hands the File objects across the
 * router transition (see lib/pending-files.js). It is a slim island on
 * purpose: the homepage does not pay for the whole resize workspace up front.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import Dropzone from '@/components/ui/Dropzone';
import { MAX_FILE_SIZE, RESIZE_INPUT_FORMATS } from '@/lib/constants';
import { acceptAttribute, constraintsLine } from '@/lib/hooks/upload-helpers';
import { setPendingFiles } from '@/lib/pending-files';

const ACCEPT = acceptAttribute(RESIZE_INPUT_FORMATS);
const CONSTRAINTS = constraintsLine({ formats: RESIZE_INPUT_FORMATS, maxBytes: MAX_FILE_SIZE });

export default function HeroDropzone({ className = '' }) {
    const router = useRouter();
    const [handingOver, setHandingOver] = useState(false);

    const handleFiles = useCallback((files) => {
        setPendingFiles(files);
        setHandingOver(true);
        router.push('/resize');
    }, [router]);

    return (
        <Dropzone
            id="home-dropzone"
            label="Drop an image here to resize it"
            browseLabel="Choose an image"
            constraints={CONSTRAINTS}
            accept={ACCEPT}
            state={handingOver ? 'accepted' : 'rest'}
            onFiles={handleFiles}
            disabled={handingOver}
            className={className}
        >
            <p className="text-micro text-ink-muted" aria-live="polite">
                {handingOver ? (
                    'Opening the resizer with your image…'
                ) : (
                    <>
                        Or open the{' '}
                        {/* Also the path for anyone whose file picker never opens. */}
                        <Link
                            href="/resize"
                            className="rounded-input text-accent underline underline-offset-4 transition-opacity duration-120 ease-snap hover:opacity-80"
                        >
                            resize tool
                        </Link>
                        {' '}first and set a size.
                    </>
                )}
            </p>
        </Dropzone>
    );
}
