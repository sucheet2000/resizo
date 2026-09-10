'use client';

/**
 * BatchProgress (shared)
 *
 * The one live region a batch panel mounts, empty, from its very first
 * render. A live region a screen reader has never seen before is not
 * reliably announced the same tick it is both created AND given its first
 * text, so this exists before there is anything to say. aria-atomic makes
 * the whole sentence re-read on each update rather than only the changed
 * word — one announcement, not a stream of word-by-word fragments.
 *
 * `text` is fully computed by the caller (which phase it is in, which file
 * is current, the finished-count sentence): this component has no notion of
 * "compressing" versus "converting", only of "one sentence, always mounted".
 */
export default function BatchProgress({ text }) {
    return (
        <p role="status" aria-live="polite" aria-atomic="true" className="text-ui text-ink">
            {text}
        </p>
    );
}
