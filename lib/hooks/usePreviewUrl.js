'use client';

/**
 * The object URL for the blob a tool just got back from the server.
 *
 * Imperative rather than derived from a `blob` prop on purpose. Deriving it
 * would mean creating the URL inside an effect and calling setState there,
 * which the React Compiler lint rule rejects — and rightly: the URL is created
 * in response to one event (a response landing), not in response to a render.
 *
 * The previous URL is revoked whenever a new one replaces it and again on
 * unmount, so a visitor who processes ten files in a row does not pin ten
 * decoded bitmaps in memory. The download path in useToolSubmit keeps its own,
 * separately delayed revoke — Safari and Firefox abort a download whose blob
 * URL disappears in the same tick as the click.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function usePreviewUrl() {
    const [url, setUrl] = useState(null);
    const currentRef = useRef(null);

    const show = useCallback((blob) => {
        if (currentRef.current) URL.revokeObjectURL(currentRef.current);
        currentRef.current = blob ? URL.createObjectURL(blob) : null;
        setUrl(currentRef.current);
    }, []);

    const clear = useCallback(() => show(null), [show]);

    useEffect(() => () => {
        if (currentRef.current) URL.revokeObjectURL(currentRef.current);
    }, []);

    return { url, show, clear };
}

export default usePreviewUrl;
