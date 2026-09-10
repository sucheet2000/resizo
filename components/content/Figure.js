/**
 * Figure
 *
 * A demonstration below a tool: what that tool actually did to a file, shown
 * rather than described. One image, a before/after pair, or — where a picture
 * would be the wrong medium — whatever is passed as children.
 *
 * Three things are the component's job rather than the page's, because a page
 * author forgetting any of them costs a reader something and shows up in no
 * diff:
 *
 *  - `width` and `height` are required on every image. Without them the block
 *    has no height until the bytes decode, and the paragraph under it jumps.
 *    An entry missing either is dropped instead of rendered half-formed.
 *  - `loading="lazy"` and `decoding="async"`, always. These figures sit well
 *    below the fold on a page whose whole design goal is that the tool paints
 *    first; a demonstration image must never compete with the tool for the
 *    connection.
 *  - the caption is markup, not a string, so it can carry the link back to how
 *    the numbers in it were measured. A figure whose numbers cannot be checked
 *    is decoration, and DESIGN.md does not allow decoration.
 *
 * `max-w-full` rather than `w-full`: a 240×80 signature is not scaled up to
 * fill a column it never filled. The two halves of a pair therefore render at
 * their own sizes, which for a resize is itself the point.
 *
 * A PAIR SITS ON THE CHECKERBOARD, always. Half the before/after figures on
 * this site are about transparency — a cut-out PNG on the left, the same
 * artwork filled in on the right — and a transparent source drawn on the
 * page's own background looks like an opaque image that happens to match it,
 * which is the opposite of what the figure is there to show. The checkerboard
 * is the site's existing signal for "these pixels are see-through" (DESIGN.md:
 * dropzone, preview thumbnail, result panel), so the figure uses it rather
 * than inventing a second one. It costs an opaque image nothing: the texture
 * is behind the pixels and only shows where there are none.
 *
 * A single image is left alone. The one on /change-image-dpi is a diagram
 * drawn to sit on the page, and a texture behind it would be decoration.
 *
 * @param {Array<{src: string, alt: string, width: number, height: number, label?: string}>} [images]
 * @param {import('react').ReactNode} caption
 * @param {import('react').ReactNode} [children]  a demonstration that is not a picture
 */
export default function Figure({ images, caption, children, className = '' }) {
    const list = (Array.isArray(images) ? images : []).filter(
        (image) => image?.src && image?.alt && image?.width > 0 && image?.height > 0,
    );

    if (list.length === 0 && !children) return null;

    const isPair = list.length > 1;

    return (
        <figure className={`flex flex-col gap-3 ${className}`.trim()}>
            <div className={isPair ? 'grid grid-cols-1 items-start gap-4 sm:grid-cols-2' : ''}>
                {children}
                {list.map((image) => (
                    <div key={image.src} className="flex flex-col gap-2">
                        {image.label ? (
                            <span className="font-data text-micro text-ink-muted">{image.label}</span>
                        ) : null}
                        {/* eslint-disable-next-line @next/next/no-img-element --
                            next/image would route these through an optimisation
                            service. Nothing on this site may be fetched from or
                            handed to a third party, and the CSP says so:
                            img-src is 'self' data: blob:. These are committed,
                            already-sized assets, so there is nothing to optimise. */}
                        <img
                            src={image.src}
                            alt={image.alt}
                            width={image.width}
                            height={image.height}
                            loading="lazy"
                            decoding="async"
                            className={`h-auto max-w-full rounded-input border border-line${isPair ? ' checkerboard' : ''}`}
                        />
                    </div>
                ))}
            </div>
            <figcaption className="text-ui text-ink-muted">{caption}</figcaption>
        </figure>
    );
}
