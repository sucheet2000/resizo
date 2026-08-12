/**
 * Hand-off between the homepage drop zone and /resize.
 *
 * The homepage hero has to be a working drop target at first paint (DESIGN.md
 * > Layout: "the working dropzone/panel is the first thing painted ... zero
 * scrolling"), but the resize workspace lives at /resize and that is the URL
 * that should own the visit. So the hero takes the drop and hands the File
 * objects over as the router transitions.
 *
 * A module-level slot, not sessionStorage: a File cannot be serialised, and
 * the App Router transition from / to /resize is a client-side navigation, so
 * this module is the same instance on both sides of it. Anything that reloads
 * the document loses the hand-off, which is why /resize renders a working,
 * empty drop zone regardless of whether one arrives.
 *
 * The slot is emptied by the read. A stale file must never reappear on a later
 * visit to /resize in the same tab.
 */

let pending = null;

/** @param {File[]|FileList|null} files */
export function setPendingFiles(files) {
    const list = Array.from(files ?? []).filter(Boolean);
    pending = list.length > 0 ? list : null;
}

/** @returns {File[]} the handed-over files, once. */
export function takePendingFiles() {
    const files = pending;
    pending = null;
    return files ?? [];
}

export function clearPendingFiles() {
    pending = null;
}
